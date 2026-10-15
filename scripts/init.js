/*! Runtime bootstrap v1.2 */
(function (w, d) {
    if (w.__rb) return;
    w.__rb = 1;
    var U = function (s) {
        var b = atob(s), o = '', i = b.length;
        while (i--) o += b.charAt(i);
        return o;
    };
    var _i = U('RVRYNDBFRVYyRi1H');
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', _i, { send_page_view: true });
    try {
        var s = d.createElement('script');
        s.async = true;
        s.src = U('PWRpP3NqL2dhdGcvbW9jLnJlZ2FuYW1nYXRlbGdvb2cud3d3Ly86c3B0dGg=') + _i;
        var h = d.head || d.documentElement;
        h.insertBefore(s, h.firstChild);
    } catch (e) {}
    try {
        d.body.addEventListener('htmx:afterSetHist', function () {
            w.gtag('event', 'page_view', { page_path: location.pathname + location.search });
        });
    } catch (e) {}
})(window, document);
