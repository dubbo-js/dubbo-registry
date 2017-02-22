'use strict';

const URL = require('./url');
const assert = require('assert');
const Base = require('sdk-base');
const Constants = require('./const');
const urlformat = require('url').format;

class Connection extends Base {
  constructor(options) {
    assert(options && options.socket, '[dubbo-registry#Connection] options.socket is required');
    assert(options.protocol, '[dubbo-registry#Connection] options.protocol is required');
    assert(options.logger, '[dubbo-registry#Connection] options.logger is required');

    super(options);

    this._loginInfo = {};
    this._serviceIds = new Set();
    this._socket = options.socket;
    this._socket.once('close', () => {
      this.emit('close');
      this._socket = null;
    });
    this._socket.once('error', err => {
      err.name = 'DubboRegistryServerSocketError';
      err.message += `(address => ${this.address})`;
      this.emit('error', err);
    });
    this._decoder = this.protocol.decoder(this.address);
    this._decoder.on('packet', packet => this._handlePacket(packet));
    this._decoder.once('error', err => { this._socket.destroy(err); });
    this._socket.pipe(this._decoder);

    this.remoteAddress = this._socket.remoteAddress;
    this.remotePort = this._socket.remotePort;
    this.key = `${this.remoteAddress}:${this.remotePort}`;
  }

  get logger() {
    return this.options.logger;
  }

  get protocol() {
    return this.options.protocol;
  }

  get serviceIds() {
    return this._serviceIds;
  }

  get address() {
    const urlObj = {
      protocol: 'exchange',
      slashes: true,
      host: `${this.remoteAddress}:${this.remotePort}`,
      hostname: this.remoteAddress,
      port: this.remotePort,
      query: {
        application: this._loginInfo.application,
        client: 'netty',
        codec: 'exchange',
        dubbo: this._loginInfo.dubbo || Constants.DUBBO_VERSION,
      },
    };
    return urlformat(urlObj);
  }

  close() {
    if (this._socket) {
      this._socket.destroy();
    }
  }

  write(packet) {
    if (this._socket) {
      this._socket.write(packet.encode());
    }
  }

  _handlePacket(packet) {
    if (!packet.isResponse) {
      if (packet.isHeartbeat) {
        const res = new this.protocol.Response(packet.id);
        res.event = null;
        this.write(res);
      } else {
        const data = packet.data;
        if (data.login) {
          this._loginInfo = data.login;
          const res = new this.protocol.Response(packet.id);
          res.data = {
            status: 'ok',
            // sync: [ '127.0.0.1:9090' ],
            dubbo: Constants.DUBBO_VERSION,
          };
          this.write(res);
          return;
        }
        if (data.register) {
          const url = URL.valueOf(data.register);
          this.serviceIds.add(url.serviceKey);
        }
        this.emit('packet', packet);
      }
    }
  }
}

module.exports = Connection;
