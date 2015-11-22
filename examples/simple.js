'use strict';
const CrawlKit = require('../');

const baseURL = 'https://www.google.com';
const crawler = new CrawlKit(baseURL);

crawler.addRunner('title', {
    getCompanionFiles: () => [],
    getRunnable: () => function extractTitle() { window.callPhantom(null, document.title); },
});

crawler.crawl().then((results) => {
    console.log(JSON.stringify(results, true, 2));
});
