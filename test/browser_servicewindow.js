Cu.import("resource://socialapi/modules/ProviderRegistry.jsm");
Cu.import("resource://gre/modules/Services.jsm");

function makeHTML(runner) {
  return "data:text/html;charset=utf-8," + encodeURI("<script>var run=" + runner.toSource() + ";run();</script>")
}

function test() {
  // we need a provider for all these tests.
  let cbPreTest = function(cb) {
    installTestProvider(function() {
      registry().enabled = true;
      cb();
    });
  };
  let cbPostTest = function(cb) {
    resetSocial();
    cb();
  }
  runTests(tests, cbPreTest, cbPostTest);
}

let tests = {
  testMessageOnUnload: function(cbnext) {
    let script = function() {
      var worker = window.navigator.mozSocial.getWorker();
      window.addEventListener("unload", function() {
        worker.port.postMessage({topic: "unloaded"});
        worker.port.close();
      }, false);
    }
    openSidebar(function(sidebarWindow, worker) {
      // tell the worker we want it to take not of when "unload" is posted.
      worker.port.postMessage({topic: 'testing.record-topic', data: 'unloaded'});
      // open a "service window"
      let w;
      let onopen = function() {
        // so our window is open - now close it!
        w.close();
        executeSoon(function() {
          ok(w.closed, "check the window is closed");
          worker.port.onmessage = function(evt) {
            if (evt.data.topic == "testing.recorded") {
              is(evt.data.data.length, 1, "got one unload message");
              is(evt.data.data[0].topic, "unloaded", "and it is actually unload!");
              worker.port.close();
              cbnext();
            }
          }
          worker.port.postMessage({topic: "testing.get-recorded"});
        });
      }
      w = sidebarWindow.wrappedJSObject.navigator.mozSocial.openServiceWindow(
            makeHTML(script), "test", {}, "test", onopen);
    });
  }
}
