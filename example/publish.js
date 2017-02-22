'use strict';

const RegistryClient = require('../').Client;
const client = new RegistryClient({
  address: '127.0.0.1:9090',
  appName: 'test',
});

client.publish({
  interface: 'com.gxc.demo.DemoService',
  version: '1.0.0',
  url: 'dubbo://127.0.0.1:12200/com.gxc.demo.DemoService',
});
