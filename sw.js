self.addEventListener('push', function(event) {
    let message = 'New chat message';
    if (event.data) {
        message = event.data.text();
    }

    const title = 'New Message';
    const options = {
        body: message
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});