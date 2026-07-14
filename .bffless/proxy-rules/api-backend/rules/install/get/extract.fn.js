function handler({ request }) {
  var headers = (request && request.headers) || {};
  var xff = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '';

  var firstIp = '';
  if (typeof xff === 'string' && xff.length > 0) {
    var parts = xff.split(',');
    firstIp = parts[0] ? parts[0].trim() : '';
  }

  var ip = firstIp || (request && request.ip) || 'unknown';
  var userAgent = headers['user-agent'] || headers['User-Agent'] || 'unknown';

  return {
    ip: ip,
    userAgent: userAgent,
  };
}
