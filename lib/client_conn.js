'use strict';

const net = require('net');
const url = require('url');
const Base = require('tcp-base');
const Constants = require('./const');

class Connection extends Base {
  /**
   * Registry Client Connection
   *
   * @param {Object} options
   *   {String} host - registry ip
   *   {Number} port - registry port
   *   {Logger} logger - the logger
   *   {Protocol} protocol - the protocol, default is dubbo protocol
   *   {String} serialization - serialization method, default is hessian2
   * @constructor
   */
  constructor(options) {
    if (options.timeout && !options.responseTimeout) {
      options.responseTimeout = options.timeout;
    }
    super(options);
    this.timestamp = Date.now();
    this.inited = false;
    this.ready(() => { this.inited = true; });
  }

  get address() {
    // exchange://10.125.6.220:9090?application=yyy&client=netty&codec=exchange&dubbo=2.5.3&heartbeat=600000&interface=com.alibaba.dubbo.registry.RegistryService&pid=23504&reconnect=false&timeout=10000&timestamp=1487486727452
    const urlObj = {
      protocol: 'exchange',
      slashes: true,
      host: `${this.options.host}:${this.options.port}`,
      hostname: this.options.host,
      port: this.options.port,
      query: {
        application: this.options.appName,
        client: 'netty',
        codec: 'exchange',
        dubbo: Constants.DUBBO_VERSION,
        interface: Constants.REGISTRY_SERVICE,
        heartbeat: this.options.heartbeatInterval,
        pid: process.pid,
        reconnect: false,
        timeout: this.options.timeout,
        timestamp: this.timestamp,
      },
    };
    return url.format(urlObj);
  }

  get protocol() {
    return this.options.protocol;
  }

  get serialization() {
    return this.options.serialization;
  }

  get heartBeatPacket() {
    const req = new this.protocol.Request();
    req.event = null;
    return req.encode(this.serialization);
  }

  * sendRequest(data) {
    const req = new this.protocol.Request();
    req.data = data;
    return yield this.sendThunk({
      id: req.id,
      data: req.encode(this.serialization),
    });
  }

  _handlePacket(packet) {
    if (packet.isResponse) {
      const invoke = this._invokes.get(packet.id);
      if (invoke) {
        this._finishInvoke(packet.id);
        clearTimeout(invoke.timer);
        process.nextTick(() => {
          if (packet.isSuccess) {
            invoke.callback(null, packet.data);
          } else {
            invoke.callback(new Error(packet.errorMsg || 'unknow server error'));
          }
        });
      } else if (!packet.isEvent) {
        this.logger.warn('[dubbo-registry] paired request not found, maybe it\'s removed for timeout and the response is %j', packet);
      }
    } else {
      if (packet.isHeartbeat) {
        const res = new this.protocol.Response(packet.id);
        res.event = null;
        this._socket.write(res.encode(this.serialization));
      } else {
        this.emit('request', packet);
      }
    }
  }

  _handleDecodeError(err) {
    err.message += ' (address: ' + this.address + ')';
    this.close(err);
  }

  _handleSocketError(err) {
    err.message += ' (address: ' + this.address + ')';
    if (!this.inited) {
      this.ready(err);
    } else {
      this.emit('error', err);
    }
  }

  _connect(done) {
    if (!done) {
      done = () => this.ready(true);
    }
    this._decoder = this.protocol.decoder(this.address);
    this._decoder.once('error', err => this._handleDecodeError(err));
    this._decoder.on('packet', packet => this._handlePacket(packet));

    this._socket = net.connect(this.options.port, this.options.host);
    this._socket.setNoDelay(this.options.noDelay);
    this._socket.once('close', () => { this._handleClose(); });
    this._socket.once('error', err => { this._handleSocketError(err); });
    this._socket.once('connect', done);
    this._socket.pipe(this._decoder);

    if (this.options.needHeartbeat) {
      this._heartbeatTimer = setInterval(() => {
        // there are already reqs in queue, no need heartbeat
        if (this._invokes.size > 0 || !this.isOK) {
          return;
        }
        this.sendHeartBeat();
      }, this.options.heartbeatInterval);
    }
  }
}

module.exports = Connection;
