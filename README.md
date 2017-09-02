# dubbo-registry
dubbo registry

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![David deps][david-image]][david-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/dubbo-registry.svg?style=flat-square
[npm-url]: https://npmjs.org/package/dubbo-registry
[travis-image]: https://img.shields.io/travis/dubbo-js/dubbo-registry.svg?style=flat-square
[travis-url]: https://travis-ci.org/dubbo-js/dubbo-registry
[codecov-image]: https://codecov.io/gh/dubbo-js/dubbo-registry/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/dubbo-js/dubbo-registry
[david-image]: https://img.shields.io/david/dubbo-js/dubbo-registry.svg?style=flat-square
[david-url]: https://david-dm.org/dubbo-js/dubbo-registry
[snyk-image]: https://snyk.io/test/npm/dubbo-registry/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/dubbo-registry
[download-image]: https://img.shields.io/npm/dm/dubbo-registry.svg?style=flat-square
[download-url]: https://npmjs.org/package/dubbo-registry

## Introduction

[Dubbo](http://dubbo.io/) Registry Client & Server Nodejs Implement

- Configurable service discovery and registry
- Pluggable loadbalancing, currently round robin provided
- Disaster recovery
- ...

![image](http://dubbo.io/dubbo-relation.jpg-version=1&modificationDate=1325860239000.jpg)

## Install

```bash
$ npm install dubbo-registry --save
```

## API

- **RegistryServer**
  - `new RegistryServer(options)`
    - {Number} port - the listening port
    - {Protocol} protocol - the exchange protocol, default is [dubbo protocol](https://github.com/dubbo-js/dubbo-remoting)
    - {Logger} logger - the logger instance, default is console
  - `* close()` shutdown the server

- **RegistryClient**
  - `new RegistryClient(options)`
    - {String} address - registry server address, sush as `127.0.0.1:9090`
    - {String} [defaultPort] - default port is 9090, you can override it
    - {String} [username] - registry server login username
    - {String} [password] - registry server login password
    - {Protocol} protocol - the exchange protocol, default is [dubbo protocol](https://github.com/dubbo-js/dubbo-remoting)
    - {String} appName - the application name
    - {Logger} logger - the logger instance, default is console
  - `* close()` shutdown the client
  - `subscribe(reg, listener)` subscribing service addresses
    - {Object} reg
      - {String} interfaceName - service interfaceName, for example: 'com.test.TestService'
      - {String} version - service version
      - {String} group - service group
    - {Function} listener - the addresses change listener
  - `unSubscribe(reg, listener)` cancel subscribing service
    - {Object} reg
      - {String} interfaceName - service interfaceName, for example: 'com.test.TestService'
      - {String} version - service version
      - {String} group - service group
    - {Function} listener - the addresses change listener
  - `publish(reg)` publishing a service
    - {Object} reg
      - {String} interfaceName - service interfaceName, for example: 'com.test.TestService'
      - {String} version - service version
      - {String} group - service group
      - {String} url - service url

## Usage

**A simple server**
```js
const { Server: RegistryServer } = require('dubbo-registry');
const server = new RegistryServer({ port: 9090 });

server.ready(() => {
  console.log('server is ready');
});
```

**Client publish a service**
```js
const { Client: RegistryClient } = require('dubbo-registry');
const client = new RegistryClient({
  address: `127.0.0.1:9090`,
  appName: 'test',
});

client.publish({
  interfaceName: 'com.demo.DemoService',
  version: '1.0.0',
  url: 'dubbo://127.0.0.1:12200/com.demo.DemoService',
});
```

**Client subscribe a service**
```js
const { Client: RegistryClient } = require('dubbo-registry');
const client = new RegistryClient({ port: 9090 });

const client = new RegistryClient({
  address: `127.0.0.1:12200`,
  appName: 'test',
});

client.subscribe({
  interfaceName: 'com.demo.DemoService',
  version: '1.0.0',
}, addresses => {
  console.log('service addrs => ', addresses);
});
```