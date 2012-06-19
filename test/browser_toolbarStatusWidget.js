function test() {
  runTests(tests, function(cb) {resetSocial(); cb()});
}

// this hard-coded "50" value also exist in toolbarStatusWidget.js for now.
const PANEL_OFFSET = 50;

let tests = {
  testNotificationPanel: function(cbnext) {
    installTestProvider(function() {
      let r = registry();
      r.enabled = true;
      // we should not need the sidebar window here, but waiting for it
      // gives the worker time to iniialize.
      openSidebar(function(sidebarWindow, worker) {
        let container = window.document.getElementById("social-status-content-container");
        let iconContainer = container.querySelector(".social-notification-icon-container");
        let panel = window.document.getElementById("social-notification-panel");
        let panelBrowser = window.document.getElementById("social-notification-browser");
        panelBrowser.addEventListener("DOMContentLoaded", function loadListener() {
          panelBrowser.removeEventListener("DOMContentLoaded", loadListener);
          executeSoon(function() { // let any other load listeners fire..
            is(panel.state, "open", "check the panel is open");
            let notifElt = panelBrowser.contentDocument.getElementById("notif");
            is(panel.width, notifElt.clientWidth+PANEL_OFFSET, "check panel width is correct");
            is(panel.height, notifElt.clientHeight+PANEL_OFFSET, "check panel height is correct");
            // now we change the height and width of the div - the panel should magically adjust its size.
            notifElt.setAttribute("style", "width:430px; height:500px");
            executeSoon(function() {
              is(notifElt.clientWidth, 430, "check new width of elt");
              is(notifElt.clientHeight, 500, "check new height of elt");
              is(panel.width, 430+PANEL_OFFSET, "check new panel width is correct");
              is(panel.height, 500+PANEL_OFFSET, "check new panel height is correct");
              // now we check the panel gets an 'unload' event - the test panel
              // will send the worker a message when this happens.
              worker.port.postMessage({topic: 'testing.record-topic', data: 'panel-unloaded'});
              worker.port.onmessage = function(evt) {
                if (evt.data.topic == "testing.recorded") {
                  is(evt.data.data.length, 1, "got one unload message");
                  is(evt.data.data[0].topic, "panel-unloaded", "and it is actually unload!");
                  worker.port.close();
                  cbnext();
                }
              }
              panel.hidePopup();
              executeSoon(function() { // wait for it to actually close.
                worker.port.postMessage({topic: "testing.get-recorded"});
              });
            });
          });
        }, false);
        // "click" on the panel anchor.
        iconContainer.setAttribute("id", "social-test-id-icon-container"); // need an ID to simulate a click event!
        EventUtils.sendMouseEvent({type: "click"}, "social-test-id-icon-container");
      })
    });
  }
}
