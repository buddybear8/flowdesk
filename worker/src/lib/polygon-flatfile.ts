// lib/polygon-flatfile.ts
//
// Streams a Polygon daily trade flat file from Polygon's S3 (files.polygon.io)
// and yields parsed rows in our normalized RawPolygonTrade shape.
//
// Path: s3://flatfiles/us_stocks_sip/trades_v1/{YYYY}/{MM}/{YYYY-MM-DD}.csv.gz
//
// Pipeline:
//   S3 GetObject → response.Body (Readable) → zlib.createGunzip() → csv-parser
//
// Memory: O(1) — never buffers the whole file. Each row passes through the
// pipe and is yielded to the consumer. Filtering happens downstream.
//
// Auth: POLYGON_ACCESS_KEY + POLYGON_SECRET_KEY (Polygon's S3 credentials,
// distinct from our own AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).

import { S3Client, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import csv from "csv-parser";
import type { RawPolygonTrade } from "./polygon-trade-filter.js";

const POLYGON_ENDPOINT = process.env.POLYGON_ENDPOINT ?? "https://files.massive.com";
const POLYGON_BUCKET = "flatfiles";

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  const ak = process.env.POLYGON_ACCESS_KEY;
  const sk = process.env.POLYGON_SECRET_KEY;
  if (!ak || !sk) {
    throw new Error("POLYGON_ACCESS_KEY / POLYGON_SECRET_KEY required for flat-file access");
  }
  _client = new S3Client({
    endpoint: POLYGON_ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: ak, secretAccessKey: sk },
    // Polygon serves files.polygon.io with a cert valid only for the bare
    // hostname; without forcePathStyle the SDK requests
    // {bucket}.files.polygon.io which fails TLS verification.
    forcePathStyle: true,
  });
  return _client;
}

export function flatFileKey(day: Date): string {
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");
  return `us_stocks_sip/trades_v1/${y}/${m}/${y}-${m}-${d}.csv.gz`;
}

/**
 * Async iterator over rows of the day's flat file. Returns null if the file
 * doesn't exist (non-trading day or not yet published).
 */
export async function* streamDailyFlatFile(day: Date): AsyncGenerator<RawPolygonTrade, void, undefined> {
  const key = flatFileKey(day);
  const c = client();

  let resp;
  try {
    resp = await c.send(new GetObjectCommand({ Bucket: POLYGON_BUCKET, Key: key }));
  } catch (err) {
    if (err instanceof NoSuchKey || (err as any)?.name === "NoSuchKey" || (err as any)?.$metadata?.httpStatusCode === 404) {
      return;
    }
    throw err;
  }
  if (!resp.Body) return;

  // resp.Body in Node is a Readable; pipe through gunzip → csv-parser.
  const body = resp.Body as Readable;
  const parser = body.pipe(createGunzip()).pipe(csv());

  for await (const row of parser) {
    const parsed = parseCsvRow(row);
    if (parsed !== null) yield parsed;
  }
}

/**
 * csv-parser yields a string-keyed object per row. Convert to RawPolygonTrade.
 * Returns null on rows missing required fields (rare but possible at file
 * head/tail).
 */
function parseCsvRow(row: Record<string, string>): RawPolygonTrade | null {
  const ticker = row.ticker;
  const id = row.id;
  if (!ticker || !id) return null;

  const price = Number(row.price);
  const size = Number(row.size);
  const sip = row.sip_timestamp;
  if (!Number.isFinite(price) || !Number.isFinite(size) || !sip) return null;

  let sipNs: bigint;
  try {
    sipNs = BigInt(sip);
  } catch {
    return null;
  }

  const exchange = row.exchange ? Number(row.exchange) : null;
  const trfId = row.trf_id ? Number(row.trf_id) : null;

  return {
    ticker,
    id,
    price,
    size: Math.trunc(size),
    sipTimestampNs: sipNs,
    exchange: exchange !== null && Number.isFinite(exchange) ? Math.trunc(exchange) : null,
    trfId: trfId !== null && Number.isFinite(trfId) ? Math.trunc(trfId) : null,
  };
}
