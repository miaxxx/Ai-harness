/** Validate the HTTPS root used for business pages and delegated runtime origin binding.
 * @param value Configured enterprise Web address.
 * @returns Normalized HTTPS origin with a trailing slash.
 */
export function validateBusinessWebURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('企业工作台地址必须是无凭证、参数或路径的 HTTPS 根地址。')
  }
  return url.origin + '/'
}
