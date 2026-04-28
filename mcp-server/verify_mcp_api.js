const http = require('http');

async function testMcpTool() {
  console.log('1. Connecting to SSE endpoint to get sessionId...');
  
  const sseReq = http.get('http://localhost:3100/sse', (res) => {
    let sessionId = '';
    
    res.on('data', (chunk) => {
      const data = chunk.toString();
      console.log('Received from SSE:', data);
      
      // MCP SSE sends the session ID in the first "endpoint" event
      // e.g. event: endpoint\ndata: /messages?sessionId=...
      const match = data.match(/sessionId=([a-zA-Z0-9-]+)/);
      if (match && !sessionId) {
        sessionId = match[1];
        console.log('2. Found Session ID:', sessionId);
        
        // Now call the tool!
        callTool(sessionId);
      }
    });
  });

  sseReq.on('error', (e) => {
    console.error('SSE Connection failed. Is the server running? ', e.message);
  });
}

function callTool(sessionId) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'lookup_user_by_phone',
      arguments: {
        phone: '9747296409'
      }
    }
  });

  console.log('3. Sending Tool Call Payload to /messages...');
  
  const postOptions = {
    hostname: 'localhost',
    port: 3100,
    path: `/messages?sessionId=${sessionId}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    }
  };

  const req = http.request(postOptions, (res) => {
    let responseData = '';
    res.on('data', (chunk) => { responseData += chunk; });
    res.on('end', () => {
      console.log('4. Server Response Status:', res.statusCode);
      console.log('5. Tool Response:', responseData || '(empty - check SSE output)');
      console.log('\n✅ If status is 202 and you saw data in the SSE log, the tool API is working!');
      process.exit(0);
    });
  });

  req.on('error', (e) => {
    console.error('POST request failed:', e.message);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

testMcpTool();
