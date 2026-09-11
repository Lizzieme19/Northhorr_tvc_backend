const net = require('net');

const testPort = (port) => {
  const client = new net.Socket();
  client.setTimeout(5000);
  
  console.log(`Testing port ${port}...`);
  
  client.connect(port, 'smtp.gmail.com', () => {
    console.log(`Successfully connected to smtp.gmail.com on port ${port}`);
    client.destroy();
  });
  
  client.on('error', (err) => {
    console.error(`Error connecting to port ${port}:`, err.message);
  });
  
  client.on('timeout', () => {
    console.error(`Connection to port ${port} timed out`);
    client.destroy();
  });
};

testPort(587);
setTimeout(() => testPort(465), 1000);
