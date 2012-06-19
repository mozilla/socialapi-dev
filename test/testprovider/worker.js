/*
* This is a test provider for automation purposes.
*/

function testLog(subject, data) {
  dump("[test provider worker]" + "\t" + subject + "\t" + data + "\n");
}

var apiPort;
function postAPIMessage(topic, data) {
  try {
    apiPort.postMessage({topic: topic, data: data});
  } catch (ex) {
    testLog("error", "failed to post api message: " + ex);
  }
}

var topicsToRecord = {};
var topicsRecorded = [];

var allPorts = [];

onconnect = function(e) {
  var port = e.ports[0];
  allPorts.push(port);

  port.onmessage = function(e) {
    testLog("port.onmessage", JSON.stringify(e.data));
    var msg = e.data;
    // Some special support for automated tests - we can "record" some
    // topics and return them when requested so the test suite can confirm
    // whatever it needs to confirm.
    if (topicsToRecord[msg.topic]) {
      topicsRecorded.push(msg);
    }

    if (msg.topic == "testing.record-topic") {
      topicsToRecord[msg.data] = true;
    } else if (msg.topic == "testing.get-recorded") {
      port.postMessage({topic: "testing.recorded", data: topicsRecorded});
      topicsRecorded = [];
    } else if (msg.topic == "testing.ping") {
      port.postMessage({topic: "testing.pong", data: msg.data});
    } else if (msg.topic == "testing.make-api-request") {
      apiPort.postMessage(msg.data);
    } else if (msg.topic == "social.port-closing") {
      var index = allPorts.indexOf(port);
      if (index != -1) {
        allPorts.splice(index, 1);
      }
      if (port == apiPort) {
        apiPort.close();
        apiPort = null;
      }
      return;
    }
    else if (msg.topic == "social.initialize") {
      apiPort = port;
      initializeAmbientNotifications();
    }
    else if (msg.topic == "social.user-recommend-prompt") {

      testLog("info", "getting prompt");
      try {
        // NB this ONLY works on this port - you can't do it to the saved one
        port.postMessage({
            topic: 'social.user-recommend-prompt-response',
            data:
              {
                img: "resource://socialapi/testprovider/testprovider/recommend.png",
                message: "Test Recommend!"
              }}
        );
        testLog("info", "okay, sent recommend");
      } catch (e) {
        testLog("error", e);
      }
    }
    else if (msg.topic == "social.user-recommend") {
      testLog("info", "recommend");
      //var buf = bufferToArrayHack([]);
      //testLog("info", "Hey, buf is " + buf);
      broadcast("recommendClicked", {url:msg.data.url});
    }
    else if (msg.topic == "social.cookie-changed") {

    }
    else if (msg.topic == "social.notification-click") {

    } else {
      testLog("warning", "Unhandled message: " + msg.topic);
    }
  }
}

function broadcast(topic, payload)
{
  for (var i = 0; i < allPorts.length; i++) {
    allPorts[i].postMessage({topic: topic, data: payload});
  }
}

function initializeAmbientNotifications() {

  postAPIMessage('social.ambient-notification-area',
  {
    portrait: "https://example.com/browser/browser/features/socialapi/test/testprovider/portrait.png"
  });

	postAPIMessage('social.ambient-notification-update',
		{
		  name: "ambient-notification-1", 
		  counter: 1,
		  background: 'url("https://example.com/browser/browser/features/socialapi/test/testprovider/notification1.png") transparent no-repeat',
		  contentPanel: "https://example.com/browser/browser/features/socialapi/test/testprovider/notification1.htm"
	 });


	postAPIMessage('social.ambient-notification-update',
		{
		  name: "ambient-notification-2", 
      counter: 1,
      background: 'url("https://example.com/browser/browser/features/socialapi/test/testprovider/notification2.png") transparent no-repeat',
      contentPanel: "https://example.com/browser/browser/features/socialapi/test/testprovider/notification2.htm"
	 });
}
