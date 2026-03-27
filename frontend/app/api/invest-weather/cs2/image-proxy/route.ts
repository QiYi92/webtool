import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REQUEST_TIMEOUT_MS = 10000;
const CURL_TIMEOUT_SECONDS = 15;
const ALLOWED_HOSTNAME = "img.zbt.com";
const REQUEST_HEADERS = {
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Referer: "https://steamdt.com/"
};

const execFileAsync = promisify(execFile);

function errorResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function curlImage(url: string) {
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--compressed",
    "--connect-timeout",
    String(CURL_TIMEOUT_SECONDS),
    "--max-time",
    String(CURL_TIMEOUT_SECONDS),
    "--header",
    `Accept: ${REQUEST_HEADERS.Accept}`,
    "--header",
    `User-Agent: ${REQUEST_HEADERS["User-Agent"]}`,
    "--header",
    `Referer: ${REQUEST_HEADERS.Referer}`,
    url
  ];

  const { stdout } = await execFileAsync("curl", args, {
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024
  });

  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target) {
    return errorResponse("Missing url", 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target);
  } catch {
    return errorResponse("Invalid url", 400);
  }

  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== ALLOWED_HOSTNAME) {
    return errorResponse("Forbidden image host", 403);
  }

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      cache: "no-store",
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (upstream.ok) {
      const contentType = upstream.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return new Response(buffer, {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=86400, s-maxage=86400",
          "Content-Type": contentType
        }
      });
    }
  } catch {}

  try {
    const buffer = await curlImage(parsedUrl.toString());
    return new Response(buffer, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Content-Type": "image/png"
      }
    });
  } catch (error) {
    console.error("[invest-weather:cs2:image-proxy] failed", error);
    return errorResponse("Failed to fetch image", 502);
  }
}
