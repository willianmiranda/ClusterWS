"use strict";

var cluster = require("cluster"), HTTP = require("http"), HTTPS = require("https"), WebSocket = require("uws"), crypto = require("crypto");

function logError(e) {
    return console.log("[31m%s[0m", e);
}

function logReady(e) {
    return console.log("[36m%s[0m", e);
}

function logWarning(e) {
    return console.log("[33m%s[0m", e);
}

function randomString(e) {
    return crypto.randomBytes(Math.ceil(e / 2)).toString("hex").slice(0, e);
}

var EventEmitter = function() {
    function e() {
        this.events = {};
    }
    return e.prototype.on = function(e, r) {
        if ("[object Function]" !== {}.toString.call(r)) return logError("Listener must be a function");
        this.events[e] = r;
    }, e.prototype.emit = function(e) {
        for (var r = [], n = 1; n < arguments.length; n++) r[n - 1] = arguments[n];
        var t = this.events[e];
        t && t.call.apply(t, [ null ].concat(r));
    }, e.prototype.onmany = function(e, r) {
        if ("[object Function]" !== {}.toString.call(r)) return logError("Listener must be a function");
        this.events[e] ? this.events[e].push(r) : this.events[e] = [ r ];
    }, e.prototype.emitmany = function(e) {
        for (var r = [], n = 1; n < arguments.length; n++) r[n - 1] = arguments[n];
        var t, o = this.events[e];
        if (o) for (var s = 0, i = o.length; s < i; s++) (t = o[s]).call.apply(t, [ null ].concat(r));
    }, e.prototype.removeListener = function(e, r) {
        var n = this.events[e];
        if (n) for (var t = 0, o = n.length; t < o; t++) if (n[t] === r) return n.splice(t, 1);
    }, e.prototype.removeEvent = function(e) {
        this.events[e] = null;
    }, e.prototype.removeEvents = function() {
        this.events = {};
    }, e;
}();

function encode(e, r, n) {
    switch (n) {
      case "ping":
        return e;

      case "emit":
        return JSON.stringify({
            "#": [ "e", e, r ]
        });

      case "publish":
        return JSON.stringify({
            "#": [ "p", e, r ]
        });

      case "system":
        switch (e) {
          case "subsribe":
            return JSON.stringify({
                "#": [ "s", "s", r ]
            });

          case "unsubscribe":
            return JSON.stringify({
                "#": [ "s", "u", r ]
            });

          case "configuration":
            return JSON.stringify({
                "#": [ "s", "c", r ]
            });
        }
    }
}

function decode(e, r) {
    switch (r["#"][0]) {
      case "e":
        return e.events.emit(r["#"][1], r["#"][2]);

      case "p":
        return e.channels[r["#"][1]] && e.worker.wss.publish(r["#"][1], r["#"][2]);

      case "s":
        switch (r["#"][1]) {
          case "s":
            var n = function() {
                return e.channels[r["#"][2]] = 1;
            };
            return e.worker.wss.middleware.onsubscribe ? e.worker.wss.middleware.onsubscribe(e, r["#"][2], function(e) {
                return e && n();
            }) : n();

          case "u":
            return e.channels[r["#"][2]] = null;
        }
    }
}

var Socket = function() {
    function e(e, r) {
        var n = this;
        this.worker = e, this.socket = r, this.channels = {}, this.events = new EventEmitter(), 
        this.missedPing = 0;
        var t = function(e) {
            return n.channels[e.channel] && n.send(e.channel, e.data, "publish");
        }, o = setInterval(function() {
            return n.missedPing++ > 2 ? n.disconnect(4001, "No pongs") : n.send("#0", null, "ping");
        }, this.worker.options.pingInterval);
        this.worker.wss.onmany("#publish", t), this.send("configuration", {
            ping: this.worker.options.pingInterval,
            binary: this.worker.options.useBinary
        }, "system"), this.socket.on("error", function(e) {
            return n.events.emit("error", e);
        }), this.socket.on("close", function(e, r) {
            clearInterval(o), n.events.emit("disconnect", e, r), n.worker.wss.removeListener("#publish", t);
            for (var s in n) n[s] && (n[s] = null);
        }), this.socket.on("message", function(e) {
            if (n.worker.options.useBinary && "string" != typeof e && (e = Buffer.from(e).toString()), 
            "#1" === e) return n.missedPing = 0;
            try {
                e = JSON.parse(e);
            } catch (e) {
                return logError("PID: " + process.pid + "\n" + e + "\n");
            }
            decode(n, e);
        });
    }
    return e.prototype.on = function(e, r) {
        this.events.on(e, r);
    }, e.prototype.send = function(e, r, n) {
        void 0 === n && (n = "emit"), this.socket.send(this.worker.options.useBinary ? Buffer.from(encode(e, r, n)) : encode(e, r, n));
    }, e.prototype.disconnect = function(e, r) {
        this.socket.close(e, r);
    }, e;
}(), Broker = function() {
    function e() {}
    return e.Client = function(r, n, t, o) {
        var s = new WebSocket(r);
        s.on("open", function() {
            o && logReady("Socket has been reconnected"), s.send(n);
        }), s.on("error", function(o) {
            if ("uWs client connection error" === o.stack) return e.Client(r, n, t, !0);
            logError("Socket " + process.pid + " has an issue: \n" + o.stack + "\n");
        }), s.on("close", function(o, s) {
            if (4e3 === o) return logError("Wrong authorization key");
            logWarning("Something went wrong, socket will be reconnected as soon as possible"), 
            e.Client(r, n, t, !0);
        }), s.on("message", function(e) {
            return "#0" === e ? s.send("#1") : t.broadcastMessage("", e);
        }), t.setBroker(s);
    }, e.Server = function(r, n, t) {
        var o, s = [];
        function i(e, r) {
            for (var n = 0, t = s.length; n < t; n++) s[n].id !== e && s[n].send(r);
        }
        new WebSocket.Server({
            port: r
        }, function() {
            return process.send({
                event: "READY",
                pid: process.pid
            });
        }).on("connection", function(e) {
            var r = !1, c = setTimeout(function() {
                return e.close(4e3, "Not Authenticated");
            }, 5e3), a = setInterval(function() {
                return e.send("#0");
            }, 2e4);
            e.on("message", function(a) {
                switch (a) {
                  case "#1":
                    return;

                  case n:
                    if (r) return;
                    return r = !0, function e(r) {
                        r.id = randomString(16);
                        for (var n = 0, t = s.length; n < t; n++) if (s[n].id === r.id) return e(r);
                        s.push(r);
                    }(e), clearTimeout(c);
                }
                r && (i(e.id, a), o && t && o.send(a));
            }), e.on("close", function() {
                if (clearTimeout(c), clearInterval(a), r) for (var n = 0, t = s.length; n < t; n++) if (s[n].id === e.id) return s.splice(n, 1);
            });
        }), t && e.Client("ws://" + (t.master ? "127.0.0.1" : t.url) + ":" + t.port, t.key || "", {
            broadcastMessage: i,
            setBroker: function(e) {
                return o = e;
            }
        });
    }, e;
}(), extendStatics = Object.setPrototypeOf || {
    __proto__: []
} instanceof Array && function(e, r) {
    e.__proto__ = r;
} || function(e, r) {
    for (var n in r) r.hasOwnProperty(n) && (e[n] = r[n]);
};

function __extends(e, r) {
    function n() {
        this.constructor = e;
    }
    extendStatics(e, r), e.prototype = null === r ? Object.create(r) : (n.prototype = r.prototype, 
    new n());
}

var WSServer = function(e) {
    function r() {
        var r = null !== e && e.apply(this, arguments) || this;
        return r.middleware = {}, r;
    }
    return __extends(r, e), r.prototype.setMiddleware = function(e, r) {
        this.middleware[e] = r;
    }, r.prototype.sendToWorkers = function(e) {
        this.broker.send(Buffer.from(JSON.stringify({
            channel: "sendToWorkers",
            data: e
        }))), this.middleware.onMessageFromWorker && this.middleware.onMessageFromWorker(e);
    }, r.prototype.publish = function(e, r) {
        "sendToWorkers" !== e && (this.broker.send(Buffer.from(JSON.stringify({
            channel: e,
            data: r
        }))), this.middleware.onpublish && this.middleware.onpublish(e, r), this.emitmany("#publish", {
            channel: e,
            data: r
        }));
    }, r.prototype.broadcastMessage = function(e, r) {
        var n = JSON.parse(Buffer.from(r).toString());
        if ("sendToWorkers" === n.channel) return this.middleware.onMessageFromWorker && this.middleware.onMessageFromWorker(n.data);
        this.middleware.onpublish && this.middleware.onpublish(n.channel, n.data), this.emitmany("#publish", n);
    }, r.prototype.setBroker = function(e) {
        this.broker = e;
    }, r;
}(EventEmitter), Worker = function() {
    return function(e, r) {
        var n = this;
        this.options = e, this.wss = new WSServer(), Broker.Client("ws://127.0.0.1:" + this.options.brokerPort, r, this.wss), 
        this.server = this.options.tlsOptions ? HTTPS.createServer(this.options.tlsOptions) : HTTP.createServer(), 
        new WebSocket.Server({
            server: this.server,
            verifyClient: function(e, r) {
                return n.wss.middleware.verifyConnection ? n.wss.middleware.verifyConnection.call(null, e, r) : r(!0);
            }
        }).on("connection", function(e) {
            return n.wss.emit("connection", new Socket(n, e));
        }), this.server.listen(this.options.port, function() {
            n.options.worker.call(n), process.send({
                event: "READY",
                pid: process.pid
            });
        });
    };
}(), ClusterWS = function() {
    function e(r) {
        if ("[object Function]" !== {}.toString.call(r.worker)) return logError("Worker must be provided and it must be a function \n \n");
        var n = {
            port: r.port || (r.tlsOptions ? 443 : 80),
            worker: r.worker,
            workers: r.workers || 1,
            useBinary: r.useBinary || !1,
            brokerPort: r.brokerPort || 9346,
            tlsOptions: r.tlsOptions || !1,
            scaleOptions: r.scaleOptions || !1,
            pingInterval: r.pingInterval || 2e4,
            restartWorkerOnFail: r.restartWorkerOnFail || !1
        };
        cluster.isMaster ? e.master(n) : e.worker(n);
    }
    return e.master = function(e) {
        var r = !1, n = randomString(16), t = {};
        function o(s, i) {
            var c = cluster.fork();
            c.send({
                processName: s,
                key: n
            }), c.on("message", function(n) {
                return "READY" === n.event && function(n, s, i) {
                    if (r) return logReady(n + " has restarted");
                    if ("Scaler" === n) return o("Broker", 0);
                    if ("Broker" === n) for (var c = 1; c <= e.workers; c++) o("Worker", c);
                    if (t[s] = i, Object.keys(t).length === e.workers + 1) {
                        r = !0, logReady(">>> Master on: " + e.port + ", PID: " + process.pid + (e.tlsOptions ? " (secure)" : ""));
                        for (var a in t) t[a] && "0" === a ? logReady(">>> Broker on: " + e.brokerPort + ", PID " + t[a]) : logReady("       Worker: " + a + ", PID " + t[a]);
                    }
                }(s, i, n.pid);
            }), c.on("exit", function() {
                logWarning(s + " has been disconnected \n"), e.restartWorkerOnFail && (logWarning(s + " is restarting \n"), 
                o(s, i));
            });
        }
        e.scaleOptions && e.scaleOptions.master ? o("Scaler", -1) : o("Broker", 0);
    }, e.worker = function(e) {
        process.on("message", function(r) {
            switch (r.processName) {
              case "Worker":
                return new Worker(e, r.key);

              case "Broker":
                return Broker.Server(e.brokerPort, r.key, e.scaleOptions);

              case "Scaler":
                return e.scaleOptions && Broker.Server(e.scaleOptions.port, e.scaleOptions.key || "");
            }
        }), process.on("uncaughtException", function(e) {
            return logError("PID: " + process.pid + "\n" + e.stack + "\n"), process.exit();
        });
    }, e;
}();

module.exports = ClusterWS, module.exports.default = ClusterWS;
