'use strict';

const net = require('net');
const URL = require('./url');
const Base = require('sdk-base');
const Constants = require('./const');
const protocol = require('dubbo-remoting');
const Connection = require('./server_conn');

const defaultOptions = {
  port: 9090,
  protocol,
  logger: console,
};

class RegistryServer extends Base {
  constructor(options) {
    super(Object.assign({}, defaultOptions, options));

    this._inited = false;
    this._connections = new Map(); // conn key => conn
    this._subscribers = new Map(); // serviceId => { consumer, provider }
    this._registry = new Map(); // serviceId => { consumer, provider }
    this._server = net.createServer();
    this._server.listen(options.port, () => {
      this.ready(true);
      this._inited = true;
    });
    this._server.once('error', err => {
      if (!this._inited) {
        this.ready(err);
      }
      this._error(err);
    });
    this._server.once('close', () => { this.emit('close'); });
    this._server.on('connection', socket => { this._handleSocket(socket); });
    this.on('providers_changed', serviceId => { this._notify(serviceId); });
  }

  get logger() {
    return this.options.logger;
  }

  get protocol() {
    return this.options.protocol;
  }

  * close() {
    if (this._server) {
      this._server.close();
      yield this.await('close');
      this._server = null;
    }
  }

  _notify(serviceId) {
    this.logger.info('[dubbo-registry#server] providers of service:%s changed, notify consumers', serviceId);
    const conns = this._subscribers.get(serviceId) || {};
    const consumerSet = conns.providers;
    if (!consumerSet || !consumerSet.size) {
      this.logger.warn('[dubbo-registry#server] no consumers for service:%s', serviceId);
      return;
    }
    const reg = this._registry.get(serviceId) || {};
    const map = reg.providers;
    if (!map || !map.size) {
      this.logger.warn('[dubbo-registry#server] no providers for service:%s', serviceId);
      return;
    }

    const result = {};
    for (const str of map.values()) {
      const url = URL.valueOf(str);
      result[url.toIdentityString()] = url.toParameterString();
    }
    const req = new this.protocol.Request();
    req.data = {
      notify: {
        [serviceId]: result,
      },
    };

    for (const key of consumerSet.values()) {
      const conn = this._connections.get(key);
      if (!conn) {
        continue;
      }
      conn.write(req);
    }
  }

  _unRegister(serviceId, conn) {
    const reg = this._registry.get(serviceId);
    for (const category in reg) {
      if (reg[category].delete(conn.key)) {
        setImmediate(() => { this.emit(`${category}_changed`, serviceId); });
      }
    }
  }

  _unSubscribe(serviceId, conn) {
    const conns = this._subscribers.get(serviceId);
    for (const category in conns) {
      conns[category].delete(conn.key);
    }
  }

  _handleSocket(socket) {
    const conn = new Connection({
      socket,
      logger: this.logger,
      protocol: this.protocol,
    });
    this._connections.set(conn.key, conn);
    conn.once('close', () => { this._handleClose(conn); });
    conn.on('error', err => { this._error(err); });
    conn.on('packet', packet => this._handlePacket(packet, conn));
  }

  _handleClose(conn) {
    for (const serviceId of conn.serviceIds.values()) {
      this._unSubscribe(serviceId, conn);
      this._unRegister(serviceId, conn);
    }
    this._connections.delete(conn.key);
    this.logger.info('[dubbo-registry#server] conn#%s close', conn.key);
  }

  _handleRegister(packet, conn) {
    const register = packet.data.register;
    this.logger.info('[dubbo-registry#server] receive register packet => %s', register);
    const url = URL.valueOf(register);
    const serviceId = url.serviceKey;
    const arr = url.getParameter(Constants.CATEGORY_KEY, Constants.DEFAULT_CATEGORY).split(',');
    const reg = this._registry.get(serviceId) || {};
    for (const category of arr) {
      reg[category] = reg[category] || new Map();
      reg[category].set(conn.key, register);
      setImmediate(() => { this.emit(`${category}_changed`, serviceId); });
    }
    this._registry.set(serviceId, reg);

    const res = new this.protocol.Response(packet.id);
    res.data = {
      status: 'ok',
    };
    conn.write(res);
  }

  _handleSubscribe(packet, conn) {
    const subscribe = packet.data.subscribe;
    this.logger.info('[dubbo-registry#server] receive subscribe packet => %s', subscribe);
    const url = URL.valueOf(subscribe);
    const serviceId = url.serviceKey;
    let serviceName = serviceId;
    let version = url.getParameter(Constants.VERSION_KEY);
    if (serviceId.includes(':')) {
      const arr = serviceId.split(':');
      serviceName = arr[0];
      version = arr[1];
    }
    const arr = url.getParameter(Constants.CATEGORY_KEY, Constants.DEFAULT_CATEGORY).split(',');
    const reg = this._registry.get(serviceId) || {};
    const conns = this._subscribers.get(serviceId) || {};
    const result = [ `empty://0.0.0.0/${serviceName}?category=configurators&version=${version}` ];
    for (const category of arr) {
      conns[category] = conns[category] || new Set();
      conns[category].add(conn.key);

      const map = reg[category];
      if (map) {
        for (const url of map.values()) {
          result.push(url);
        }
      }
    }
    this._subscribers.set(serviceId, conns);

    const res = new this.protocol.Response(packet.id);
    res.data = {
      status: 'ok',
      notify: result,
    };
    conn.write(res);
  }

  _handleUnRegister(packet, conn) {
    const unregister = packet.data.unregister;
    this.logger.info('[dubbo-registry#server] receive unregister packet => %s', unregister);
    const url = URL.valueOf(unregister);
    const serviceId = url.serviceKey;
    const category = url.getParameter(Constants.CATEGORY_KEY, Constants.DEFAULT_CATEGORY);
    const reg = this._registry.get(serviceId);
    if (reg[category] && reg[category].delete(conn.key)) {
      setImmediate(() => { this.emit(`${category}_changed`, serviceId); });
    }

    const res = new this.protocol.Response(packet.id);
    res.data = { status: 'ok' };
    conn.write(res);
  }

  _handleUnSubscribe(packet, conn) {
    const unsubscribe = packet.data.unsubscribe;
    this.logger.info('[dubbo-registry#server] receive unsubscribe packet => %s', unsubscribe);
    const url = URL.valueOf(unsubscribe);
    const serviceId = url.serviceKey;
    this._unSubscribe(serviceId, conn);

    const res = new this.protocol.Response(packet.id);
    res.data = { status: 'ok' };
    conn.write(res);
  }

  _handlePacket(packet, conn) {
    const data = packet.data || {};
    if (data.register) {
      this._handleRegister(packet, conn);
    } else if (data.subscribe) {
      this._handleSubscribe(packet, conn);
    } else if (data.unregister) {
      this._handleUnRegister(packet, conn);
    } else if (data.unsubscribe) {
      this._handleUnSubscribe(packet, conn);
    }

    // TODO: shutdown
    //   Request {
    //     id: 3,
    //     version: '2.0.0',
    //     isTwoWay: false,
    //     isEvent: false,
    //     isBroken: false,
    //     data: { logout: 'shutdown' } }
  }

  _error(err) {
    setImmediate(() => { this.emit('error', err); });
  }
}

module.exports = RegistryServer;
