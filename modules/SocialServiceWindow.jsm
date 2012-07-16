const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");

const EXPORTED_SYMBOLS = ["openServiceWindow", "getWebProgressListener"];

function getWebProgressListener(aOrigin) {
  // prevent location changes outside our origin
  return {
    QueryInterface: function(aIID) {
      if (aIID.equals(Ci.nsIWebProgressListener)   ||
          aIID.equals(Ci.nsISupportsWeakReference) ||
          aIID.equals(Ci.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
    },
    onStateChange: function(/*in nsIWebProgress*/ aWebProgress,
                       /*in nsIRequest*/ aRequest,
                       /*in unsigned long*/ aStateFlags,
                       /*in nsresult*/ aStatus) {
      // we have to block during STATE_START to prevent the current page onloading
      // and leaving about:blank in our service window.
      let docStart = aStateFlags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT &&
                     aStateFlags & Ci.nsIWebProgressListener.STATE_START;

      if (aStateFlags & docStart && aRequest.name) {
        let rURI = Services.io.newURI(aRequest.name, null, null);
        if (aOrigin != rURI.prePath && rURI.prePath.indexOf("resource:") != 0) {
          aRequest.cancel(Cr.NS_BINDING_ABORTED);
          return;
        }
      }
    },
    onProgressChange: function() {},
    onLocationChange: function() {},
    onStatusChange: function() {},
    onSecurityChange: function() {}
  }
}

function openServiceWindow(aService, aTargetWindow, aURL, aName, aOptions) {
  // resolve partial URLs and check prePath matches
  let fullURL = Services.io.newURI(aTargetWindow.location.href,null,null).resolve(aURL);
  let dURI = Services.io.newURI(fullURL, null, null);
  if (aService.origin != dURI.prePath && dURI.prePath.indexOf("resource:") != 0) {
    Cu.reportError("unable to load new location, "+aService.origin+" != "+dURI.prePath);
    return undefined;
  }

  // See if we've already got one...
  let xulWindow = Services.ww.getWindowByName(aName, null);
  if (xulWindow) {
    let content = xulWindow.document.getElementById("content");
    return content.contentWindow;
  }

  let contentWindow = aTargetWindow.openDialog(fullURL, aName, "chrome=no,dialog=no,"+aOptions);

  // we need to do a couple things on the actual xul window
  xulWindow = contentWindow.document.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIWebNavigation)
                 .QueryInterface(Ci.nsIDocShellTreeItem)
                 .rootTreeItem
                 .QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIDOMWindow);

  // give the window a reference to the service provider object
  xulWindow.service = aService;

  // since we used aTargetWindow to open the window, if we do not set the name
  // here, getWindowByName will fail to find this window again.
  xulWindow.name = aName;

  // hook up our weblistener to prevent redirects to other sites
  let content = xulWindow.document.getElementById("content");
  content.addProgressListener(getWebProgressListener(aService.origin));

  // we dont want the default title the browser produces, we'll fixup whenever
  // it changes
  xulWindow.addEventListener("DOMTitleChanged", function() {
    let sep = xulWindow.document.documentElement.getAttribute("titlemenuseparator");
    xulWindow.document.title = xulWindow.service.name + sep + contentWindow.document.title;
  });

  return contentWindow;
}
