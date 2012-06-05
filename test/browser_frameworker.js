let modules = {};
Cu.import("resource://socialapi/modules/frameworker.js", modules);

function makeWorkerUrl(runner) {
  return "data:application/javascript," + encodeURI("let run=" + runner.toSource()) + ";run();"
}

function test() {
  runTests(tests);
}

let tests = {
  testSimple: function(cbnext) {
    let run = function() {
      onconnect = function(e) {
        let port = e.ports[0];
        port.onmessage = function(e) {
          if (e.data.topic == "ping") {
            port.postMessage({topic: "pong"});
          }
        }
      }
    }

    let worker = modules.FrameWorker(makeWorkerUrl(run), undefined, "testSimple");
    worker.port.onmessage = function(e) {
      if (e.data.topic == "pong") {
        worker.terminate();
        cbnext();
      }
    }
    worker.port.postMessage({topic: "ping"})
  },

  // when the client closes early but the worker tries to send anyway...
  testEarlyClose: function(cbnext) {
    let run = function() {
      onconnect = function(e) {
        let port = e.ports[0];
        port.postMessage({topic: "oh hai"});
      }
    }

    let worker = modules.FrameWorker(makeWorkerUrl(run), undefined, "testEarlyClose");
    worker.port.close();
    worker.terminate();
    cbnext();
  },

  // Check we do get a social.port-closing message as the port is closed.
  testPortClosingMessage: function(cbnext) {
    // We use 2 ports - we close the first and report success via the second.
    let run = function() {
      let firstPort, secondPort;
      onconnect = function(e) {
        let port = e.ports[0];
        if (firstPort === undefined) {
          firstPort = port;
          port.onmessage = function(e) {
            if (e.data.topic == "social.port-closing") {
              secondPort.postMessage({topic: "got-closing"});
            }
          }
        } else {
          secondPort = port;
          // now both ports are connected we can trigger the client side
          // closing the first.
          secondPort.postMessage({topic: "connected"});
        }
      }
    }
    let workerurl = makeWorkerUrl(run);
    let worker1 = modules.FrameWorker(workerurl, undefined, "testPortClosingMessage worker1");
    let worker2 = modules.FrameWorker(workerurl, undefined, "testPortClosingMessage worker2");
    worker2.port.onmessage = function(e) {
      if (e.data.topic == "connected") {
        // both ports connected, so close the first.
        worker1.port.close();
      } else if (e.data.topic == "got-closing") {
        worker2.terminate();
        cbnext();
      }
    }
  },

  // Tests that prototypes added to core objects work with data sent over
  // the message ports.
  testPrototypes: function(cbnext) {
    let run = function() {
      // Modify the Array prototype...
      Array.prototype.customfunction = function() {};
      onconnect = function(e) {
        let port = e.ports[0];
        port.onmessage = function(e) {
          // Check the data we get via the port has the prototype modification
          if (e.data.topic == "hello" && e.data.data.customfunction) {
            port.postMessage({topic: "hello", data: [1,2,3]});
          }
        }
      }
    }
    // hrmph - this kinda sucks as it is really just testing the actual
    // implementation rather than the end result, but is OK for now.
    // Really we are just testing that JSON.parse in the client window
    // is called.
    let fakeWindow = {
      JSON: {
        parse: function(s) {
          let data = JSON.parse(s);
          data.data.somextrafunction = function() {};
          return data;
        }
      }
    }
    let worker = modules.FrameWorker(makeWorkerUrl(run), fakeWindow, "testPrototypes");
    worker.port.onmessage = function(e) {
      if (e.data.topic == "hello" && e.data.data.somextrafunction) {
        worker.terminate();
        cbnext();
      }
    }
    worker.port.postMessage({topic: "hello", data: [1,2,3]});
  },

  testArray: function(cbnext) {
    let run = function() {
      // Modify the Array prototype...
      Array.prototype.customfunction = function() {};
      onconnect = function(e) {
        let port = e.ports[0];
        port.onmessage = function(e) {
          // Check the data we get via the port has the prototype modification
          if (e.data.topic == "go") {
            let buffer = new ArrayBuffer(10);
            // this one has always worked in the past, but worth checking anyway...
            if (new Uint8Array(buffer).length != 10) {
              port.postMessage({topic: "result", reason: "first length was not 10"});
              return;
            }
            let reader = new FileReader();
            reader.onload = function(event) {
              if (new Uint8Array(buffer).length != 10) {
                port.postMessage({topic: "result", reason: "length in onload handler was not 10"});
                return;
              }
              // all seems good!
              port.postMessage({topic: "result", reason: "ok"});
            }
            let blob = new Blob([buffer], {type: "binary"});
            reader.readAsArrayBuffer(blob);
          }
        }
      }
    }
    let worker = modules.FrameWorker(makeWorkerUrl(run), undefined, "testArray");
    worker.port.onmessage = function(e) {
      if (e.data.topic == "result") {
        is(e.data.reason, "ok", "check the array worked");
        worker.terminate();
        cbnext();
      }
    }
    worker.port.postMessage({topic: "go"});
  },

  testXHR: function(cbnext) {
    let run = function() {
      onconnect = function(e) {
        let port = e.ports[0];
        let req;
        try {
          req = new XMLHttpRequest();
        } catch(e) {
          port.postMessage({topic: "done", result: "FAILED to create XHR object, " + e.toString() });
        }
        if (req === undefined) { // until bug 756173 is fixed...
          port.postMessage({topic: "done", result: "FAILED to create XHR object"});
          return;
        }
        // read a URL from our test provider so it is in the same origin as the worker.
        // might as well just read the manifest!
        // XXX - THIS IS WRONG!  it should work with this URL as it is in our origin!!!
        // but we get a .status of 0, which implies CORS is killing us.
        // req.open("GET", "http://mochi.test:8888/browser/browser/features/socialapi/test/testprovider/app.manifest", true);
        req.open("GET", "http://enable-cors.org/", true);
        req.onreadystatechange = function() {
          if (req.readyState === 4) {
            dump("XHR: req.status " + req.status + "\n");
            let ok = req.status == 200 && req.responseText.length > 0;
            if (ok) {
              // check we actually got something sane...
              try {
                let data = JSON.parse(req.responseText);
                ok = "services" in data && "social" in data.services;
              } catch(e) {
                ok = e.toString();
              }
            }
            port.postMessage({topic: "done", result: ok});
          }
        }
        req.send(null);
      }
    }
    let worker = modules.FrameWorker(makeWorkerUrl(run), undefined, "testXHR");
    worker.port.onmessage = function(e) {
      if (e.data.topic == "done") {
        todo_is(e.data.result, "ok", "check the xhr test worked");
        worker.terminate();
        cbnext();
      }
    }
  },

  testSameOriginImport: function(cbnext) {
    let run = function() {
      onconnect = function(e) {
        let port = e.ports[0];
        port.onmessage = function(e) {
          if (e.data.topic == "ping") {
            try {
              importScripts("http://foo.bar/error");
            } catch(ex) {
              port.postMessage({topic: "pong", data: ex});
              return;
            }
            port.postMessage({topic: "pong", data: null});
          }
        }
      }
    }

    let worker = modules.FrameWorker(makeWorkerUrl(run), undefined, "testSameOriginImport");
    worker.port.onmessage = function(e) {
      if (e.data.topic == "pong") {
        isnot(e.data.data, null, "check same-origin applied to importScripts");
        worker.terminate();
        cbnext();
      }
    }
    worker.port.postMessage({topic: "ping"})
  }
}
