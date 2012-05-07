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
    log("failed to post api message: " + ex);
  }
}

onconnect = function(e) {
  var port = e.ports[0];
  port.onmessage = function(e) {

    testLog("port.onmessage", e.data)

    var msg = e.data;
    if (msg.topic == "social.port-closing") {
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
      return "resource://socialdev/testprovider/testprovider/recommend.png";
    }
    else if (msg.topic == "social.user-recommend") {

    }
    else if (msg.topic == "social.cookie-changed") {

    }
    else if (msg.topic == "social.notification-click") {

    }
  }
}

function initializeAmbientNotifications() {

  postAPIMessage('social.ambient-notification-area',
  {
    portrait: "resource://socialdev/testprovider/testprovider/portrait.png"
  });

	postAPIMessage('social.ambient-notification-update',
		{
		  name: "ambient-notification-1", 
		  counter: 1,
		  background: 'url("resource://socialdev/testprovider/testprovider/notification1.png") transparent no-repeat',
		  contentPanel: "resource://socialdev/testprovider/testprovider/notification1.htm"
	 });


	postAPIMessage('social.ambient-notification-update',
		{
		  name: "ambient-notification-2", 
      counter: 1,
      background: 'url("resource://socialdev/testprovider/testprovider/notification2.png") transparent no-repeat',
      contentPanel: "resource://socialdev/testprovider/testprovider/notification2.htm"
	 });

}