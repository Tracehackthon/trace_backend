export function readOAuthCallback(search = '', hash = '') {
  const query = new URLSearchParams(search)
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/, ''))) {
    if (query.has(key) && query.get(key) !== value) throw new Error('授权回调参数冲突，请重新发起登录')
    query.set(key, value)
  }
  const officialCode = query.get('authorization_code')
  const legacyCode = query.get('code')
  if (officialCode && legacyCode && officialCode !== legacyCode) throw new Error('授权回调参数冲突，请重新发起登录')
  return { code: officialCode || legacyCode, state: query.get('state'), error: query.get('error') }
}
