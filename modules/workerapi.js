// This is the API we expose to workers.  Sometimes we will use this
// API to call into the worker and sometimes the worker will call into
// us.  Sometimes these calls will happen as a direct response to a previous
// call (ie, a request is made then a response is returned).  Other times the
// call might be unsolicited and a one-shot.

EXPORTED_SYMBOLS = ["workerAPI"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

var notification = {};
Cu.import("resource://socialdev/modules/notification.js", notification);

function workerAPI(worker, service) {
  this.initialize(worker, service)
}

workerAPI.prototype = {
  initialize: function(worker, service) {
    this.service = service;
    this.worker = worker;
    worker.port.onmessage = function(event) {
      let {topic, data} = event.data;
      if (!topic) {
        return;
      }
      try {
        let handler = this.workerapi[topic];
        if (!handler) {
          Cu.reportError("worker called unimplemented API function '" + topic + "'");
          return;
        }
        handler.call(this, worker, data);
      } catch (ex) {
        Cu.reportError("failed to handle api message '" + topic + "': " + ex + "\n" + ex.stack);
      }
    }.bind(this);
    // and send an "intro" message so the worker knows this is the port
    // used for the api.
    // later we might even include an API version - version 0 for now!
    worker.port.postMessage({topic: "social.initialize"});
  },

  shutdown: function() {
    this.worker.port.close();
    this.worker = this.service = null;
  },

  // This is the API exposed to the worker itself by way of messages.
  workerapi: {
    'social.notification-create': function(worker, data) {
      let n;
      let {icon, title, body, id} = data;
      let onclick = function() {
        worker.port.postMessage({topic: "social.notification-click",
                          data: {id: id}});
      }
      let onhide = function() {
        n = null;
      }
      n = notification.Notification(icon, title, body, id, onclick, onhide);
      n.show();
    },
    'social.ambient-notification-update': function(worker, data) {
      let ani = this.service.createAmbientNotificationIcon(data.name);
      if (data.background) {
        ani.setBackground(data.background);
      }
      if (data.counter) {
        ani.setCounter(data.counter);
      }
      if (data.contentPanel) {
        ani.setContentPanel(data.contentPanel);
      }
    },
    'social.ambient-notification-area': function(worker, data) {
      if (data.background) {
        this.service.setAmbientNotificationBackground(data.background);
      }
      if (data.portrait) {
        this.service.setAmbientNotificationPortrait(data.portrait);
      }
    },
  }
}
