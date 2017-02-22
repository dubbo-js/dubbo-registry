'use strict';

const RegistryServer = require('../../').Server;
const port = Number(process.argv[2] || 9090);
console.log('port =>', process.argv, port);
const server = new RegistryServer({ port });

server.ready(() => {
  console.log('server is ready');
  process.send('ready');
});

server.on('close', () => {
  console.log('server closed');
});
