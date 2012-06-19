function test() {
  // we need a provider for all these tests.
  let cbPreTest = function(cb) {
    installTestProvider(function() {
      registry().enabled = true;
      cb();
    });
  };
  runTests(tests, cbPreTest);
}

let tests = {
  testCookies: function(cbnext) {
    openSidebar(function(sidebarWindow, worker) {
      worker.port.postMessage({topic: 'testing.record-topic', data: 'social.cookie-changed'});
      // set a cookie via the sidebar.
      sidebarWindow.wrappedJSObject.document.cookie = "name=value";
      // the notification somes in after one second, so we just retry a few
      // times until we give up in disgust or we get it.
      let retryCount = 0;
      let checkNotification = function() {
        worker.port.onmessage = function(evt) {
          if (evt.data.topic == "testing.recorded") {
            if (evt.data.data.length == 0 && retryCount < 10) {
              info("no cookie notification yet - retrying");
              retryCount++;
              sidebarWindow.setTimeout(checkNotification, 250);
              return;
            }
            is(evt.data.data.length, 1, "got one cookie-changed message");
            is(evt.data.data[0].topic, "social.cookie-changed", "and it is actually cookie-changed!");
            // now check we can get the cookie value.
            worker.port.onmessage = function(evt) {
              if (evt.data.topic == "testing.recorded") {
                dump("testing.recorded is " + JSON.stringify(evt.data) + "\n");
                is(evt.data.data.length, 1, "got one cookie-response message");
                is(evt.data.data[0].topic, "social.cookies-get-response", "and it is actually the cookie response");
                is(evt.data.data[0].data.length, 1, "got one cookie");
                is(evt.data.data[0].data[0].name, "name", "cookie has the correct name");
                is(evt.data.data[0].data[0].value, "value", "cookie has the correct value");
                worker.port.close();
                cbnext();
              }
            }
            worker.port.postMessage({topic: 'testing.record-topic', data: 'social.cookies-get-response'});
            worker.port.postMessage({topic: "testing.make-api-request",
                                     data: {topic: "social.cookies-get"}});
            executeSoon(function() {
              executeSoon(function() {
                worker.port.postMessage({topic: "testing.get-recorded"});
              });
            });
          }
        }
        worker.port.postMessage({topic: "testing.get-recorded"});
      }
      sidebarWindow.setTimeout(checkNotification, 250);
    });
  }
}

