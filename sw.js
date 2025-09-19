self.addEventListener('push', function(event) {
    let message = 'New chat message';
    if (event.data) {
        message = JSON.parse(event.data.text()).body;
    }

    const title = 'New Message';
    const options = {
        body: message
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});