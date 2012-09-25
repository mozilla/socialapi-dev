Browser Social API Reference
============================

The "test" directory contains a test provider implementation that demonstrates the use of many of these APIs.  Reading through it will help illustrate the documentation provided here.

## Contents

1. Terms
2. Creation and Lifecycle of a Social Service Worker
3. Service Worker API Reference
    1. Methods available to Service Workers
    2. Messages Sent By Service Workers
    3. Messages Sent To Service Workers
4. Service Content API Reference
    1. Methods
5. Widgets
    1. SidebarWidget
        1. Messages Sent To Widget
        2. Browser Visual Integration
        3. Browser Panel Integration
    2. ShareWidget
        1. Messages Sent To Widget
6. Service Windows
7. Message Serialization
8. Discovery and Installation
9. Example Interactions

# Terms

**Social Service Provider:**

A web service that provides one or more APIs to a browser to enable social features. It is defined to the browser by a structured text file, which instructs the browser how to load JavaScript and HTML resources that brings its functions into the browser.

**Service Worker:**
A long-running JS computation environment, managed by the browser, served by a user-specified web address, which acts as a coordination and communication hub for integration between the browser and a web service.

**Widget:**
A user-interface element, created by the browser, which provides a visual region for the display of content produced by the Service Provider.

**Service Message:**
A message is a JSON-encoded string that is either sent by the browser to the Service Worker, or sent by the Service Worker to the browser. These messages are used to coordinate the display of browser-managed user interface elements and to respond to user and content interactions. See Message Serialization for encoding details.

**Sidebar:**
A vertical rectangle of screen space, positioned to the side of normal browser content in a tabbed browser window, which is stable across brower navigation and tab-focus changes. A Sidebar may be minimized, which causes it to be rendered entirely in "above-the-content/not-overlaid-over-content" layout space.

**Recommend:**
The user-initiated act of indicating that a piece of web content (typically a URL) should be marked as being of interest to a user. No input other than than the URL is expected. A Recommend can be completed with no Widget; it has no user interface other than the button, menu bar, or command that indicates "recommend this".

**Share:**
The user-initiated act of sending a piece of web content (typically a URL) with an optional comment, explanation, or other data, to a user address, list of user addresses, social network, or other destination. The details of a Share interaction are service-specific and a ShareWidget is required to render the user interface to complete a share.

**Client-to-User Notification:**
Client-to-User Notification is the API that is made available to a Service Worker to indicate that data and interactions are pending for the user on this particular device, and that the service is ready to provide them. Subject to the browser's configuration, these notifications may be used to trigger a variety of attention-getting interface elements, including "toast" or "Growl"-style ephemeral windows, ambient notifications (e.g. glowing, hopping, pulsing), or collections (e.g. pull-down notification panels, lists of pending events). These Notifications are constructed to allow the Service Worker to receive notification when the user indicates interest in one of them, allowing the data presentation or interaction to proceed immediately.

**Server-to-Client Notification:**
Server-to-Client Notification is a system by which a service arranges for notifications to be delivered promptly and efficiently to a client. It is not a feature of this proposal, though existing web techniques including WebSockets, Server-Sent Events, XMLHttpRequest with long polling (or infrequently quick polling) can all be used from Service Workers. It is expected that a Service Worker that has received a Server-to-Client Notification will often relay this data into a Client-to-User Notification.

**Panel:**
A user-interface region (typically rectangular) that is temporarily displayed above content and browser chrome, used for short-lived interactions that are user-initiated or very important.

Creation and Lifecycle of a Social Service Worker
=================================================

It is expected that a Social Service Provider will be defined by a structured text file (JSON) containing a number of keyed URLs, a name, an icon, and a "root domain" prefix.

A Service Worker is instantiated with the Service Worker URL provided by the service provider, which should resolve to a JavaScript file that will be evaluated by the Server Worker. The Worker is a Shared Worker, rendered "headlessly", in a style very similar to the Web Workers specification (though note that the current implementation is not, in fact, a Worker)

The Service Worker lives until terminated, either by browser shutdown or by an explicit control command from the user.

If the browser determines that termination of the Service Worker is necessary, all of the service-level content associated with the Service Worker will be unloaded (i.e. all ServiceWindows and sidebars will be closed) as part of the termination.

If the browser starts (or restarts) the service during a normal user session, the Service Worker will be fully loaded first, and sidebars will then be instantiated on existing windows. ServiceWindows (e.g. chats) are not restarted automatically.

Service Worker Reference
========================

A Service Worker inherits all the limitations and behaviors available to HTML5 Shared Workers. It can create XMLHttpRequests, use WebSockets, receive messages from windows and the browser, use IndexedDB, and post messages to other windows.

The Worker can use the `ononline`, `onoffline`, and `navigator.online` methods and properties that are available to all Workers to obtain notification of the browser's online/offline status.

In addition to the standard methods, Service Workers have access to additional functionality, all of which are implemented using messages sent and received by worker "message ports".  As message ports are inherently asynchronous, any message that requires a response will involve two messages - one for the request and one for the response.  Not all message require a response - this is part of the message specification.  Messages which don't require a response are analogous to an unsolicitied 'event'.  If a message does require a response, then the response must always be sent on the same port as the request and in general, the 'topic' of the response will be the topic of the request with "-response" appended.

Service workers are expected to provide functions, at global scope, named `onconnect` and `ondisconnect`.  The browser will invoke `onconnect` at startup time, passing in an event.  The worker should access the `ports` property of this event to extract a stable communication port back to the browser, and persist it for the life of the worker, like this:

```
var apiPort;
var ports = [];
onconnect = function(e) {
    var port = e.ports[0];
    ports.push(port);
    port.onmessage = function (msgEvent)
    {
        var msg = msgEvent.data;
        if (msg.topic == "social.port-closing") {
            if (port == apiPort) {
                apiPort.close();
                apiPort = null;
            }
            return;
        }
        if (msg.topic == "social.initialize") {
            apiPort = port;
            initializeAmbientNotifications();
        }
    }
}

// send a message to all provider content
function broadcast(topic, data) {
  for (var i = 0; i < ports.length; i++) {
    ports[i].postMessage({topic: topic, data: data});
  }
}
```

Every message has a data element with 2 fields; 'topic' and 'data'.  The topic identifies which method or event is being used, and the data specifies additional data unique to the topic.  All standardized methods and events have topics that begin with "social." - this means services are free to use topics without this prefix as a private implementation detail (for example, to communicate between some content from the service and the service's worker)


Control Messages sent to Service Workers
----------------------------------------
### `social.initialize`

**STATUS: DONE Fx17**

Sent by the browser during startup.  When a worker's JavaScript has been successfully loaded and evaluated, the browser will send a message with this topic.

### `social.port-closing`

**STATUS: DONE Fx17**

Sent by the browser during worker shutdown, when a MessagePort to the worker is about to be closed.  This will be the last message the worker receives on the port.

Ambient Notification Control
----------------------------
### `social.user-profile`

**STATUS: DONE Fx17**

Sent by the worker, to set the properties for the provider icon and user profile data used for the toolbar button.  If the users portrait and userName are absent, the button UI will indicate a logged out state.  When indicating logged out state, status icons set via `social.ambient-notification` will be removed.

*Arguments:*

**background** DEPRECATED, replaced by iconURL
> String, optional.  If supplied, specifies the CSS value for the background
of the area.  Typically this will just supply a background color.  UPDATE: the
data url is parsed to provide the iconURL.  This currently works, however
using sprite icons produces incorrect results.

**iconURL**
> String, required.  If supplied, specifies the URL to a 16x16 pixel image
used for the status icon. The iconURL can be a data url with encoded image to
avoid additional http requests. (e.g. "data:image/png;base64,...data...")

**portrait**
> String, optional.  If supplied, specifies the URL to a 48x48 pixel image
of the user.  The portrait can be a data url with encoded image to
avoid additional http requests.

**userName**
> String, optional.  Account name displayed with the portrait in the provider menu.

**dispayName**
> String, required.  Real name of the user used for display purposes in various UI elements.

**profileURL**
> String, required.  URL to the logged in users profile page.  This will be opened in a normal browser tab when the username is clicked on.


### `social.ambient-notification`

**STATUS: DONE Fx17**

Sent by the worker, to update or create an ambient notification icon.  One is sent for each icon.  A user must be logged in to show status icons, and you must call `social.user-profile` prior to calling `social.ambient-notification` to set status icons.

*Arguments:*

**name**
> String.  An identifier for the icon.  The first time a given name is seen,
it effectively creates a new icon.  If the same name is used in subsequent
calls, the existing icon is updated.

**background** DEPRECATED, replaced by iconURL
> String, optional.  If supplied, specifies the CSS value for the background
of the area.  Typically this will just supply a background color.  UPDATE: the
data url is parsed to provide the iconURL.  This currently works, however
using sprite icons produces incorrect results.

**iconURL**
> String, optional.  If supplied, specifies the URL to a 16x16 pixel image
used for the status icon.  The iconURL can be a data url with encoded image to
avoid additional http requests. (e.g. "data:image/png;base64,...data...")

**counter**
> Number, optional.  Specifies a number that will be overlaid over the icon,
typically used to convey an `unread` concept.

**contentPanel**
> String, optional.  Specifies the URL of content that will be displayed in
the popup panel for the icon.


Active Notification Control
---------------------------
### `social.notification-create`

**STATUS: DONE Fx17, BUG 774506**

Sent by the worker, to create and display a notification object. This requests that the browser notify the user of an immediately-relevant change in state. See https://developer.mozilla.org/en/DOM/navigator.mozNotification for more detail.  When the user clicks on the notification, the `social.notification-action` message is sent to the worker.  The title of the notification will always be the name of the provider.

NOTE: We want to augment the mozNotification object defined in the docs with an additional "type" field. Details TBD.
NOTE: No way of allowing duration and no way exposed to "cancel" a notification (assumption is they are very short-lived).  Is this OK?

*Arguments:*

**id**
> String: An ID for the notification.  This ID will not be displayed but will be passed back via a `social.notification-action` event if the user clicks on the notification.  

**type**
> String: The Type string should be consistent for each **type** of notification.  This may be used by some notification systems to provide user level filtering of notifications.  A provider may choose any string for the type, but should keep the type strings consistent and descriptive for each type of action.  For example, chat notifications should always have the same type string.  Suggested/example notifications include:

* social.providername.chat-request
* social.providername.friend-request
* social.providername.activity (e.g. someone posted to your activity stream)

**icon**
> String/null. The URL of an image to be placed in the notification.  While this can be any valid URL, implementers are strongly encouraged to use a data URL to minimize latency.

**body**
> String: The body of the notification message.  This body will be rendered as a hyperlink and may be clicked.  HTML markup is not supported.

**action**
> String: An action to perform when the user clicks on the notification.  If no action is provided, the notification is not clickable.  Currently the only actions supported are ***link***, ***callback*** and ***openServiceWindow***.  If the action is defined, actionArgs should also be defined.

**actionArgs**
> Object: An object with arguments for actions (above).  Supported actions and their actionArgs are:

* link
  * toURL: String: url to open in a new browser tab


### `social.notification-action`

**STATUS: TARGETED Fx17, BUG 774506**

Sent to the worker as a response to a "callback" notification, after the user has clicked on the notification.

*Arguments:*

**id**
> String: the ID of the notification that was clicked.

**action**
> String: The **action** sent in `social.notification-create`.

**actionArgs**
> Object: The **actionArgs** sent in `social.notification-create`.



Link Recommendation Control
---------------------------

### `social.user-recommend-prompt`

**STATUS: DONE Fx17**

Sent by the browser to request the visual prompt for the "user recommendation" interface element. The Worker should respond with a user-recommend-prompt-response

Note that typically this message will only be sent when a provider is activated and the response will be used for all URLs.  In other words, the provider should not expect this message to be sent each time the user agent navigates or displays a new URL.

*Arguments:*

None

### `social.user-recommend-prompt-response`

**STATUS: DONE Fx17**

The Worker constructs and posts a user-recommend-prompt-response in response to a `social.user-recommend-prompt` message received from the browser.  See `social.user-recommend-prompt` for more details.

*Arguments:*

**images**
> Object. Must have 2 string keys, 'share' and 'unshare', which each value being the URL to an image which will be set as the "src" property of an image contained in the user-facing click target for the "recommend" action.  The user agent will track if the current page has been shared - if so, it will show the 'unshare' image, otherwise will show the 'share' image. It can contain a web-addressible image or a data URL containing dynamically-generated image data. Implementors are strongly encouraged to use a data URL to minimize latency.  Each image is expected to be 16px wide and 16px high.

**messages**
> Object.  Must have the following string keys:

* 'shareTooltip', 'unshareTooltip': The strings used as the tooltip on the click target when the 'share' and 'unshare' images, respectively, are shown.
* 'sharedLabel', 'unsharedLabel': Strings that will be used to update a label widget after the 'share' or 'unshare' action is taken to reflect the transition from shared-to-unshared or vice-versa.  Note that in Fx17, the labels are not visible but are used as an accessibility aid so a screen-reader or similar can note the transition.
* 'unshareLabel': A string to be displayed on the 'unshare popup' to reflect the item has been shared.  Eg: "You previously shared this item".
* 'portraitLabel': A string used as the aria-label for the user's profile image shown in the 'unshare popup'.  Eg: "Your profile image"
* 'unshareConfirmLabel': A string used as the label on the button on the 'unshare popup' used to perform the 'unshare'.  Eg: "Unshare it"
* 'unshareConfirmAccessKey': A string used as the access key for the unshare button.  Typically this should be a letter included in the 'unshareConfirmLabel' string.
* 'unshareCancelLabel': A string used as the label on the button on the 'unshare popup' when the user desires to continue sharing the item.  Eg: "Close".
* 'unshareCancelAccessKey': A string used as the access key for the unshare cancel button.

###  `social.user-recommend`

Indicates that the user has clicked the "user recommendation" interface element. The message includes:

*Arguments:*

**url**
> String, required. The URL that the user is viewing, including query string, but minus any hash text, of the root of the current browser viewing context.

No response is necessary; however, the service may respond on the same port with a user-recommend-prompt-response if the click target should change its appearance.

### `social.user-unrecommend`

Indicates that the user would like to retract their previous recommendation. The message includes:

*Arguments:*

**url**
> String, required. The URL that the user is viewing, including query string, but minus any hash text, of the root of the current browser viewing context.


Service Content API Reference
=============================

These methods are available to all Widget and ServiceWindow content.

Methods:
--------
### `navigator.mozSocial.getWorker()`

**STATUS: DONE Fx17**

returns a reference to the Service Worker.

The content can then call postMessage on it as normal.  Messages posted this way may be private implementation messages or any of the standard `social.` messages described above.

### `navigator.mozSocial.openServiceWindow( url, name, options, callback)`

**STATUS: DONE Fx17**

Creates a new window, initially displaying the `url` page.  A reference to the window is returned as the first argument to `callback`.  Content in the window is not guaranteed to be loaded at the time of the callback.  This window will not have navigation controls or toolbars.  An attempt to create a "service window" with a domain that does not match the domain of the Service Provider is an error and will have no effect.

"service windows" will contain a single content region, with no tabbed browser elements, and no navigation chrome. The browser will display domain and security badges as its implementers see fit. The browser may implement "pinning" to attach the content region to an existing chrome window; content should observe the size of its window and reflow as needed.

Messages may be posted to and from the service window as normal. If the `name` argument passed to the function matches an existing window that is already open, a reference to that window is returned, via `callback`, rather than opening a new one.

Calls to `openServiceWindow` are subject to normal anti-popup behavior: windows may only be opened in the event context of a user click. `window.onunload` is available as normal; implementers are encouraged to use it to notify the service that a window is closing.

### `navigator.mozSocial.openChatWindow( url, callback)`

**STATUS: TARGETED Fx17, BUG 779686**

Opens a chat window that is anchored to the bottom of the browser window.  Each chat window is expected to
be a singular chat, but functionality may vary by provider.  The `callback` receives a windowRef of the 
content in the chat window.

### `navigator.mozSocial.openPanel( url, offset, callback)`

**STATUS: TARGETED Fx17, BUG 779923**

Opens a flyout attached to the sidebar at a vertical offset.  The `callback` receives a windowRef to the
content in the flyout.

### `navigator.mozSocial.getAttention( )`

**STATUS: DONE Fx17**

Operation varies by platform.  May flash the window or otherwise notify the user that the application
needs attention.

### `navigator.mozSocial.isVisible`

**STATUS: TARGETED Fx17, BUG 779360**

Boolean value, True if the content is visible.

Widgets
=======

SidebarWidget
-------------

If a service defines a SidebarWidget, the browser will instantiate a content region with the SidebarWidget URL as the location on some browser windows. These regions will not be instantiated until the Worker has been fully loaded. The content in these regions has the additional API defined in the Service Content API reference, above.

Sidebars can be in a *visible* or *hidden* state.

* When visible, they will receive a vertical rectangle of screen space in which to render; this rectangle is stable across changes in tab focus and has an independent scrollbar from the scrollbar of tabbed browsing content.
* When hidden, a sidebar is completely removed from the visual hierarchy. The user agent will continue to deliver messages to it, and the sidebar may pre-render its DOM for later display.

Sidebar windows will only be instantiated on browser windows that have a full tabbed-browsing interface; windows created with window.open that do not have these interface elements will not have a sidebar.

When a tab that is rendered directly by the browser without a location bar is selected, the sidebar will automatically be placed into the *hidden* state.  When the user navigates away from that tab, the sidebar will be made *visible* again.  These tabs include the Add-ons management page, about:permissions, etc.

The minimized/maximized/hidden state of the sidebar widget is will be consistent across all browser windows. The most-recently-set state is remembered and used for new windows, and is persisted across browser restarts.

Messages Sent to Widget
-----------------------

**STATUS: DONE Fx17**

### `sidebarHide`

DOM Event sent by the browser when the user hides the sidebar content.

### `sidebarShow`

DOM Event sent by the browser when the user shows the sidebar content.

Browser "Panel" Integration
---------------------------

To allow content to place an ephemeral window in front of normal browser content and chrome, the following API is used:

    TODO - not yet implemented

ShareWidget
===========

If a service defines a ShareWidget, when the user triggers the "Share" behavior, the browser will create a "floating panel" interface element containing an IFRAME whose src is set to the ShareWidget URL. A Share event is then fired at the message, as defined in the ShareHandler section, below.

The service provider may perform content interactions in this IFRAME to prompt the user for details about the share, and may use XMLHttpRequest or window-level navigation to change the content.

The service provider should call `window.close` when the interaction with the share panel is complete. Alternatively, the user may click away from the panel, causing the window to be closed immediately.

Messages Sent to Widget:
------------------------
### `begin-share`

Sent by the browser to the share widget once the widget has loaded, providing the details of the content the user has requested to share.

**Arguments TBD**


ServiceWindows
==============

ServiceWindows are created by calling `openServiceWindow` in a Widget window.

A ServiceWindow can only serve content from the Social Service Provider's domain. Any attempt to navigate the root of the ServiceWindow's browser away from this domain will be automatically intercepted and redirected to a new tab in the front most tabbed browsing window (or a new window if no such browsing window exists).

ServiceWindow content inherits the API defined for ServiceContent above.

TODO On OSes that require an application window to be open for process visibility, does closing all the tabbed browsing windows and keeping a ServiceWindow open cause application shutdown, or does the browser keep running? If it keeps running we need a way to get a browser window back.

TODO: Need to specify more about the primary widget interactions of ServiceWindows. On Windows they get an application menu, on Mac they need to inherit some of the MenuBar (rather like prefwindows).

ServiceWindows are expected to use `getWorker()` and `postMessage()` to register with the Service Worker shortly after becoming loaded. The Service Worker can inspect the "origin" property of messages that are delivered this way to make a list of current windows, and can invoke the `close()` and `focus()` methods on these windows.

TODO: can the service see the "frontmost/hasfocus" property on these windows?

`window.onunload` is available as normal; implementers are encouraged to use it to notify the service that they are going away. The Service Worker can also inspect the .closed property of postMessage origins to see if the window has been closed.

Changes to `document.title` in the service window's content will change the title displayed on the window, in operating systems where that concept is applicable.


Message Serialization
=====================

For a message with topic `topic` and arguments (arg1:val1, arg2:val2), construct an object like:

    { topic: topic, data: { arg1: val1, arg2: val2 } }


Discovery and Service Manifest
==============================

Discovery
---------

**STATUS: NOT TARGETED**

As a user browses web sites Firefox can discover new social providers and offer installation of those
providers.  A social providers website would include a LINK tag in the header pointing to a manifest
file to enable this form of discovery.  If the user either has stored authentication credentials in
the Firefox password manager, or if the user frequents the website, Firefox will show a notification
bar allowing the user to install the service.

Activation
----------

**STATUS: DONE Fx17**

A provider can become activated by dispatching a custom event of "ActivateSocialFeature" on the document. The document's location is then checked against a built-in whitelist and if the location is found then the feature is activated for that provider.

We recommend that providers require their users to click a link or button to activate the feature so the user is aware of the new functionality.

    function activate() {
      var event = new CustomEvent("ActivateSocialFeature");
      document.dispatchEvent(event);
    }

Example interactions / expected implementation flow
===================================================

* The service is registered with a Service, Sidebar widget, and Share widget
* At browser startup time, the Service Worker is instantiated.
* The service opens a connection its service, if a user session is available, and starts receiving push events.
* When a browser window is created, the Sidebar widget content is instantiated.
* The sidebar registers with the service by using mozSocial.getWorker().postMessage("hello")
* The service worker catches the "hello" message and adds the sidebarContentWindow to a list of event sinks.
* The sidebar content may then perform more elaborate publish-subscribe handshaking, to limit what events it receives.
* When the service receives events from the server (or from other content), it invokes postMessage on each window reference that was previously saved. The sidebar redraws as needed.
* If the user clicks in the sidebar to e.g. open a chat window, window.open is invoked and a new window is created. The chat window registers with the service by using mozSocial.getWorker().postMessage("hello") and receives a message back telling it who to open a chat with. The service might then deliver server-pushed events to the chat window, perhaps through a publish-subscribe system.

To Figure Out
=============

* Should we not create a sidebar window if the user isn't signed in? Or should we create a sidebar that can present a "sign in" box?
* Do we need to blacklist some URLs for "recommend"? (i.e. anything with security-sensitive GET params)
* Still need to figure out panels popping out of sidebar, especially in minimized mode; position, sizing, asynchrony.
* Punting on any questions of content-talking-to-service right now, or vice-versa. Two worlds for now. Preference is for markup.
