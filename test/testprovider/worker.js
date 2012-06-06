/*
* This is a test provider for automation purposes.
*/

function testLog(subject, data) {
  dump(subject + "\t" + data + "\n");
}

var apiPort;
function postAPIMessage(topic, data) {
  try {
    apiPort.postMessage({topic: topic, data: data});
  } catch (ex) {
    testLog("error", "failed to post api message: " + ex);
  }
}

var allPorts = [];

onconnect = function(e) {
  var port = e.ports[0];
  allPorts.push(port);

  port.onmessage = function(e) {
    testLog("TestProvider's port.onmessage", e.data.topic + " " + e.data.data)
    var msg = e.data;
    if (msg.topic == "social.port-closing") {
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
      testLog("warning", "Unhandled message: " + msg.topic + "\n");
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
    portrait: "resource://socialapi/testprovider/testprovider/portrait.png"
  });

	postAPIMessage('social.ambient-notification-update',
		{
		  name: "ambient-notification-1", 
		  counter: 1,
		  background: 'url("resource://socialapi/testprovider/testprovider/notification1.png") transparent no-repeat',
		  contentPanel: "resource://socialapi/testprovider/testprovider/notification1.htm"
	 });


	postAPIMessage('social.ambient-notification-update',
		{
		  name: "ambient-notification-2", 
      counter: 1,
      background: 'url("resource://socialapi/testprovider/testprovider/notification2.png") transparent no-repeat',
      contentPanel: "resource://socialapi/testprovider/testprovider/notification2.htm"
	 });
}
