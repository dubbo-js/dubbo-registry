'use strict';

const RegistryServer = require('../').Server;
const server = new RegistryServer({ port: 9090 });

server.ready(() => {
  console.log('server is ready');
});
