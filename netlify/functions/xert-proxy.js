// Proxy for Xert API — forwards /oauth/* requests to xertonline.com.
// Needed because Xert blocks direct browser requests (CORS).

export const handler = async (event) => {
  // event.path is e.g. /.netlify/functions/xert-proxy/oauth/token
  const xertPath = event.path.replace('/.netlify/functions/xert-proxy', '') || '/';
  const rawQuery = event.rawQuery || '';
  const queryString = rawQuery
    ? `?${rawQuery}`
    : event.queryStringParameters
      ? `?${new URLSearchParams(event.queryStringParameters).toString()}`
      : '';
  const url = `https://www.xertonline.com${xertPath}${queryString}`;

  const headers = {
    'Content-Type': event.headers['content-type'] || 'application/x-www-form-urlencoded',
  };
  if (event.headers['authorization']) {
    headers['Authorization'] = event.headers['authorization'];
  }

  const res = await fetch(url, {
    method: event.httpMethod,
    headers,
    body: (event.httpMethod !== 'GET' && event.body) ? event.body : undefined,
  });

  const body = await res.text();

  return {
    statusCode: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    body,
  };
};
