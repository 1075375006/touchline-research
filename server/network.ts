import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as httpFetch } from "undici";
export function isPublicIp(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function validHttpUrl(value: string) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("仅支持不含用户名密码的 HTTP(S) 地址");
  return u;
}
export async function requestText(
  value: string,
  opts: {
    trusted?: boolean;
    signal?: AbortSignal;
    timeout?: number;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    limit?: number;
  } = {},
): Promise<{ text: string; url: string; contentType: string }> {
  let url = validHttpUrl(value);
  const signal = AbortSignal.any([
    AbortSignal.timeout(opts.timeout || 30000),
    ...(opts.signal ? [opts.signal] : []),
  ]);
  for (let redirects = 0; redirects < 5; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
    const allowed = opts.trusted
      ? addresses
      : addresses.filter((a) => isPublicIp(a.address));
    if (!allowed.length) throw new Error("已阻止私有网络或保留地址的网页抓取");
    const agent = new Agent({
      connect: {
        lookup: ((_host: string, options: any, cb: any) => {
          if (options?.all) cb(null, allowed);
          else cb(null, allowed[0].address, allowed[0].family);
        }) as any,
      },
    });
    try {
      const response = await httpFetch(url, {
        method: opts.method || "GET",
        headers: {
          "user-agent": "TouchlineResearch/1.0 (+source-verification)",
          ...opts.headers,
        },
        body: opts.body,
        redirect: "manual",
        signal,
        dispatcher: agent,
      });
      if (response.status >= 300 && response.status < 400) {
        const target = response.headers.get("location");
        await response.body?.cancel();
        if (opts.method && opts.method !== "GET")
          throw new Error("API 返回重定向，请填写最终接口地址");
        if (!target) throw new Error("无效重定向");
        url = validHttpUrl(new URL(target, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("上游 HTTP " + response.status);
      }
      const max = opts.limit || 2_000_000;
      const parts: Uint8Array[] = [];
      let length = 0;
      if (response.body)
        for await (const part of response.body) {
          length += part.length;
          if (length > max) {
            throw new Error("响应超过读取大小限制");
          }
          parts.push(part);
        }
      return {
        text: Buffer.concat(parts).toString("utf8"),
        url: url.href,
        contentType: response.headers.get("content-type") || "",
      };
    } finally {
      await agent.close();
    }
  }
  throw new Error("重定向次数超过限制");
}
export function canonicalUrl(value: string) {
  const u = validHttpUrl(value);
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (k.startsWith("utm_") || ["fbclid", "gclid"].includes(k))
      u.searchParams.delete(k);
  return u.href;
}
