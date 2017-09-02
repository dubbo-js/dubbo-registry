'use strict';

const net = require('net');
const assert = require('assert');
const pedding = require('pedding');
const protocol = require('dubbo-remoting');
const Connection = require('../lib/client_conn');

describe('test/client_conn.test.js', () => {
  const version = Number(process.versions.node.split('.')[0]);
  const port = 9090 + version;

  it('should connect ok', done => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
    });

    conn.ready(() => {
      conn.close();
      server.close();
      done();
    });
  });

  it('should send data & receive feedback', function* () {
    const server = net.createServer();
    server.on('connection', socket => {
      const decoder = protocol.decoder('exchange://127.0.0.1');
      decoder.on('packet', packet => {
        if (!packet.isResponse && !packet.isEvent) {
          const res = new protocol.Response(packet.id);
          res.data = packet.data;
          socket.write(res.encode());
        }
      });
      socket.pipe(decoder);
    });
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });

    const result = yield conn.sendRequest({ foo: 'bar' });
    assert.deepEqual(result, { foo: 'bar' });
    conn.close();
    server.close();
  });

  it('should send data & receive error', function* () {
    const server = net.createServer();
    server.on('connection', socket => {
      const decoder = protocol.decoder('exchange://127.0.0.1');
      decoder.on('packet', packet => {
        if (!packet.isResponse && !packet.isEvent) {
          const res = new protocol.Response(packet.id);
          res.errorMsg = 'mock error';
          res.status = 70;
          socket.write(res.encode());
        }
      });
      socket.pipe(decoder);
    });
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });

    let error;
    try {
      yield conn.sendRequest({ foo: 'bar' });
    } catch (err) {
      error = err;
    }
    assert(error && error.message === 'mock error');
    conn.close();
    server.close();
  });

  it('should send data & receive error', function* () {
    const server = net.createServer();
    server.on('connection', socket => {
      const decoder = protocol.decoder('exchange://127.0.0.1');
      decoder.on('packet', packet => {
        if (!packet.isResponse && !packet.isEvent) {
          const res = new protocol.Response(packet.id);
          res.errorMsg = 'mock error';
          res.status = 70;
          socket.write(res.encode());
        }
      });
      socket.pipe(decoder);
    });
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });

    let error;
    try {
      yield conn.sendRequest({ foo: 'bar' });
    } catch (err) {
      error = err;
    }
    assert(error && error.message === 'mock error');
    conn.close();
    server.close();
  });

  it('should receive unpair data', done => {
    const server = net.createServer();
    server.on('connection', socket => {
      const res = new protocol.Response(1000);
      res.data = {};
      socket.write(res.encode());
    });
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
      logger: {
        warn(msg, p) {
          assert(msg === '[dubbo-registry] paired request not found, maybe it\'s removed for timeout and the response is %j');
          assert(p.id === 1000);
          conn.close();
          server.close();
          done();
        },
      },
    });
  });

  it('should receive req', done => {
    const server = net.createServer();
    server.on('connection', socket => {
      const req = new protocol.Request(1000);
      req.data = { foo: 'bar' };
      socket.write(req.encode());
    });
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });

    conn.on('request', req => {
      assert(req.id === 1000);
      assert.deepEqual(req.data, { foo: 'bar' });
      conn.close();
      server.close();
      done();
    });
  });

  it('should receive heartbeat', done => {
    let conn;
    const server = net.createServer();
    server.on('connection', socket => {
      const decoder = protocol.decoder('exchange://127.0.0.1');
      decoder.on('packet', packet => {
        if (packet.isResponse && packet.isHeartbeat) {
          conn.close();
          server.close();
          done();
        }
      });
      socket.pipe(decoder);

      const req = new protocol.Request(1000);
      req.event = null;
      socket.write(req.encode());
    });
    server.listen(port, '127.0.0.1');

    conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });
  });

  it('should handle decode error', done => {
    const server = net.createServer();
    server.on('connection', socket => {
      socket.write(new Buffer('fake data'));
    });
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });

    conn.once('error', err => {
      assert(err);
      assert(err.message.includes('invalid packet with magic'));
    });
    conn.once('close', () => {
      server.close();
      done();
    });
  });

  it('should connect failed', done => {
    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });

    conn.once('error', err => {
      assert(err);
      assert(err.message.includes('ECONNREFUSED'));
    });
    conn.once('close', done);
  });

  it('should handle socket error', done => {
    const server = net.createServer();
    server.on('connection', socket => {
      setTimeout(() => {
        socket.destroy();
      }, 1000);
    });
    server.listen(port, '127.0.0.1');

    const conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
    });

    conn.once('error', err => {
      assert(err);
      console.log(err);
    });
    conn.once('close', () => {
      server.close();
      done();
    });
  });

  it('should heartbeat periodically', finish => {
    let conn;
    let server;
    const done = pedding(() => {
      conn.close();
      server.close();
      finish();
    }, 2);
    server = net.createServer();
    server.on('connection', socket => {
      const decoder = protocol.decoder('exchange://127.0.0.1');
      decoder.on('packet', packet => {
        if (!packet.isResponse && packet.isHeartbeat) {
          done();
        }
      });
      socket.pipe(decoder);
    });
    server.listen(port, '127.0.0.1');

    conn = new Connection({
      host: '127.0.0.1',
      port,
      protocol,
      timeout: 3000,
      heartbeatInterval: 1000,
    });
  });
});
