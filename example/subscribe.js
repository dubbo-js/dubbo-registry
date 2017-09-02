'use strict';

const RegistryClient = require('../').Client;
const client = new RegistryClient({
  address: '127.0.0.1:9090',
  appName: 'test',
});

client.subscribe({
  interface: 'com.gxc.demo.DemoService',
  version: '1.0.0',
}, addresses => {
  console.log('addresses => ', addresses);
});
