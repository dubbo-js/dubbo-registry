'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const rimraf = require('rimraf');
const assert = require('assert');
const helper = require('./support');
const protocol = require('dubbo-remoting');
const { Client, Server } = require('../');

describe('test/client.test.js', () => {
  const version = Number(process.versions.node.split('.')[0]);
  const port = 9090 + version;

  describe('normal', () => {
    let client;
    let server;
    before(function* () {
      server = new Server({ port });
      yield server.ready();
      client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
      });
      yield client.ready();
    });
    after(function* () {
      yield client.close();
      yield server.close();
    });

    it('should subscribe / publish ok', function* () {
      const reg = {
        interfaceName: 'com.gxc.demo.DemoService',
        version: '1.0.0',
      };
      client.subscribe(reg, val => {
        client.emit(val.length + '', val);
      });
      let addresses = yield client.await('0');
      assert(addresses.length === 0);

      client.publish({
        interfaceName: 'com.gxc.demo.DemoService',
        version: '1.0.0',
        url: 'dubbo://127.0.0.1:12200/com.gxc.demo.DemoService',
      });
      addresses = yield client.await('1');
      assert(addresses.length === 1);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      let result = yield [
        helper.fork('publish', [ port, 'dubbo://127.0.0.2:12200/com.gxc.demo.DemoService' ]),
        client.await('2'),
      ];
      addresses = result[1];
      assert(addresses.length === 2);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));
      assert(addresses[1].includes('dubbo://127.0.0.2:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      result = yield [
        helper.stop(),
        client.await('1'),
      ];
      addresses = result[1];
      assert(addresses.length === 1);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      client.unSubscribe(reg);
    });

    it('should subscribe second time', function* () {
      const reg = {
        interfaceName: 'com.gxc.demo.DemoService',
        version: '1.0.0',
      };
      const listener_1 = val => {
        client.emit('subscribe_result', val);
      };
      client.subscribe(reg, listener_1);
      let addresses = yield client.await('subscribe_result');
      assert(addresses.length === 1);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      const listener_2 = val => {
        client.emit('subscribe_result_2', val);
      };
      client.subscribe(reg, listener_2);
      addresses = yield client.await('subscribe_result_2');
      assert(addresses.length === 1);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      client.unSubscribe(reg, listener_1);

      const result = yield [
        helper.fork('publish', [ port, 'dubbo://127.0.0.2:12200/com.gxc.demo.DemoService' ]),
        client.await('subscribe_result_2'),
      ];
      addresses = result[1];
      assert(addresses.length === 2);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));
      assert(addresses[1].includes('dubbo://127.0.0.2:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      client.unSubscribe(reg, listener_2);
      yield helper.stop();
    });
  });

  describe('sync', () => {
    it('should sync ok', function* () {
      const server = net.createServer();
      server.on('connection', socket => {
        const decoder = protocol.decoder('exchange://127.0.0.1');
        decoder.on('packet', packet => {
          if (!packet.isResponse && !packet.isEvent) {
            assert(packet.data && packet.data.login);
            const res = new protocol.Response(packet.id);
            res.data = {
              status: 'ok',
              sync: [ `127.0.0.1:${port}` ],
            };
            socket.write(res.encode());
          }
        });
        socket.pipe(decoder);
      });
      server.listen(port, '127.0.0.1');

      const client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
      });
      yield client.ready();
      assert(client.isOldRegistry);

      yield client.close();
      server.close();
    });

    it('should reconnect while current address not in sync addresses', function* () {
      const server = net.createServer();
      server.on('connection', socket => {
        const decoder = protocol.decoder('exchange://127.0.0.1');
        decoder.on('packet', packet => {
          if (!packet.isResponse && !packet.isEvent) {
            assert(packet.data && packet.data.login);
            const res = new protocol.Response(packet.id);
            res.data = {
              status: 'ok',
              sync: [ '127.0.0.1:8888' ],
            };
            socket.write(res.encode());
          }
        });
        socket.pipe(decoder);
      });
      server.listen(port, '127.0.0.1');

      const client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
        retryPeriod: 1000,
      });
      try {
        yield client.await('error');
      } catch (err) {
        assert(err);
        assert(err.message.includes('ECONNREFUSED'));
      }
      yield client.close();
      server.close();
    });

    it('should reconnect success while current address not in sync addresses', function* () {
      const server = net.createServer();
      server.on('connection', socket => {
        const decoder = protocol.decoder('exchange://127.0.0.1');
        decoder.on('packet', packet => {
          if (!packet.isResponse && !packet.isEvent) {
            assert(packet.data && packet.data.login);
            const res = new protocol.Response(packet.id);
            res.data = {
              status: 'ok',
              sync: [ '127.0.0.1:8888' ],
            };
            socket.write(res.encode());
          }
        });
        socket.pipe(decoder);
      });
      server.listen(port, '127.0.0.1');

      const client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
        retryPeriod: 1000,
      });
      yield client.await('login');
      yield client.close();
      server.close();
    });

    it('should reconnect success', function* () {
      const port2 = port + 1;
      const servers = [ port, port2 ].map(p => {
        const server = net.createServer();
        server.on('connection', socket => {
          const decoder = protocol.decoder('exchange://127.0.0.1');
          decoder.on('packet', packet => {
            if (!packet.isResponse && !packet.isEvent) {
              assert(packet.data && packet.data.login);
              const res = new protocol.Response(packet.id);
              res.data = {
                status: 'ok',
                sync: [ `127.0.0.1:${port2}` ],
              };
              socket.write(res.encode());
            }
          });
          socket.pipe(decoder);
        });
        server.listen(p, '127.0.0.1');
        return server;
      });

      const client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
        retryPeriod: 1000,
      });
      yield client.ready();
      yield client.await('login');
      yield client.close();
      yield servers.map(s => s.close());
    });
  });

  describe('error', () => {
    it('should login failed', function* () {
      const server = net.createServer();
      server.on('connection', socket => {
        const decoder = protocol.decoder('exchange://127.0.0.1');
        decoder.on('packet', packet => {
          if (!packet.isResponse && !packet.isEvent) {
            assert(packet.data && packet.data.login);
            const res = new protocol.Response(packet.id);
            res.data = {
              status: 'failed',
            };
            socket.write(res.encode());
          }
        });
        socket.pipe(decoder);
      });
      server.listen(port, '127.0.0.1');
      const client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
        retryPeriod: 1000,
      });

      try {
        yield client.await('error');
      } catch (err) {
        assert(err.name === 'DubboRegistryConnectionError');
        assert(err.message.includes('[dubbo-registry] Can not connect to registry'));
      }
      yield client.close();
      server.close();
    });

    it('should emit error, if receive error message', function* () {
      const server = net.createServer();
      server.on('connection', socket => {
        const decoder = protocol.decoder('exchange://127.0.0.1');
        decoder.on('packet', packet => {
          if (!packet.isResponse && !packet.isEvent) {
            assert(packet.data && packet.data.login);
            const res = new protocol.Response(packet.id);
            res.data = {
              status: 'ok',
              message: 'error message',
            };
            socket.write(res.encode());
          }
        });
        socket.pipe(decoder);
      });
      server.listen(port, '127.0.0.1');
      const client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
        retryPeriod: 1000,
      });

      try {
        yield client.await('error');
      } catch (err) {
        assert(err.message === 'error message');
      }
      yield client.close();
      server.close();
    });
  });

  describe('local cache', () => {
    let client;
    let server;
    const localCacheDir = path.join(__dirname, 'fixtures/local_cache_dir');
    before(function* () {
      server = new Server({ port });
      yield server.ready();
      client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
        localCacheDir,
      });
      yield client.ready();
    });
    after(function* () {
      yield client.close();
      yield server.close();
      rimraf.sync(localCacheDir);
    });

    it('should write local cache', function* () {
      const reg = {
        interfaceName: 'com.gxc.demo.DemoService',
        version: '1.0.0',
      };
      client.subscribe(reg, val => {
        client.emit(val.length + '', val);
      });
      let addresses = yield client.await('0');
      assert(addresses.length === 0);

      client.publish({
        interfaceName: 'com.gxc.demo.DemoService',
        version: '1.0.0',
        url: 'dubbo://127.0.0.1:12200/com.gxc.demo.DemoService',
      });
      addresses = yield client.await('1');
      assert(addresses.length === 1);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      const filepath = path.join(localCacheDir, 'com.gxc.demo.DemoService@1.0.0');
      assert(fs.existsSync(filepath));
    });

    it('should subscribe from local cache', function* () {
      const filepath = path.join(localCacheDir, 'com.gxc.demo.DemoService@1.0.0');
      if (!fs.existsSync(filepath)) {
        fs.writeFileSync(filepath, '{"url":"consumer://30.20.78.83/com.gxc.demo.DemoService?application=test&dubbo=2.5.3&check=false&pid=44812&protocol=dubbo&revision=1.0.0&timestamp=1488267888077&category=providers%2Cconfigurators%2Crouters&methods=*&side=consumer&interface=com.gxc.demo.DemoService&version=1.0.0&group=","value":["dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3&check=false&pid=44812&protocol=dubbo&revision=1.0.0&timestamp=1488267888090&anyhost=true&codec=dubbo&methods=*&side=provider&threads=200&interface=com.gxc.demo.DemoService&version=1.0.0&group="]}');
      }

      const client = new Client({
        address: `127.0.0.1:${port}`,
        appName: 'test',
        localCacheDir,
      });

      const reg = {
        interfaceName: 'com.gxc.demo.DemoService',
        version: '1.0.0',
      };
      client.subscribe(reg, val => {
        client.emit(val.length + '', val);
      });
      const addresses = yield client.await('1');
      assert(addresses.length === 1);
      assert(addresses[0].includes('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?application=test&dubbo=2.5.3'));

      yield client.close();
    });
  });
});
