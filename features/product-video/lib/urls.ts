export function clipDownloadUrl(requestUrl: string, token: string, inline = false) {
  const url = new URL("/api/product-video/download", requestUrl);
  url.searchParams.set("token", token);
  if (inline) url.searchParams.set("inline", "1");
  return url.toString();
}
