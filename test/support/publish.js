'use strict';

const RegistryClient = require('../../').Client;
const port = Number(process.argv[2] || 9090);
const url = process.argv[3] || 'dubbo://127.0.0.1:12200/com.gxc.demo.DemoService';
const client = new RegistryClient({
  address: `127.0.0.1:${port}`,
  appName: 'test',
});

client.publish({
  interfaceName: 'com.gxc.demo.DemoService',
  version: '1.0.0',
  url,
});

setTimeout(() => {
  process.send('ready');
}, 1000);
