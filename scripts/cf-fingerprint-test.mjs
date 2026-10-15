/* Compare CF behavior: curl-style (node https) vs fetch (undici) vs fetch+full headers */
import https from "node:https";

const TARGET =
  "https://play.xpass.top/mdata/FhSRJyc1bW9UFomkT1gzTq/1/playlist.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function viaHttps(headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(TARGET, { method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({ status: res.statusCode, ct: res.headers["content-type"], body: body.slice(0, 80) }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function viaFetch(headers) {
  const res = await fetch(TARGET, { headers });
  const text = await res.text();
  return { status: res.status, ct: res.headers.get("content-type"), body: text.slice(0, 80) };
}

const r1 = await viaHttps({ "User-Agent": UA });
console.log("1) https.request + UA only      :", JSON.stringify(r1));

const r2 = await viaFetch({ "User-Agent": UA });
console.log("2) fetch (undici) + UA only     :", JSON.stringify(r2));

const r3 = await viaFetch({
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "Upgrade-Insecure-Requests": "1",
});
console.log("3) fetch (undici) + full browser:", JSON.stringify(r3));

const r4 = await viaHttps({
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
});
console.log("4) https.request + UA + accept  :", JSON.stringify(r4));
