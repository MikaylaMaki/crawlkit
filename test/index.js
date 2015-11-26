'use strict'; // eslint-disable-line
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const httpServer = require('http-server');
const path = require('path');
const freeport = require('freeport');
const auth = require('http-auth');
const http = require('http');
const httpProxy = require('http-proxy');
const HeadlessError = require('node-phantom-simple/headless_error');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const CrawlKit = require(path.join(__dirname, '..', pkg.main));
const genericLinkFinder = require('../finders/genericAnchors.js');

chai.should();
chai.use(chaiAsPromised);
chai.use(sinonChai);

const basic = auth.basic({
    realm: 'Restricted area',
}, (username, password, cb) => {
        cb(username === 'foo' && password === 'bar');
});

describe('CrawlKit', function main() {
    this.timeout(5 * 60 * 1000); // crawling can take a while
    let server;
    let proxy;
    let url;
    let proxyUrl;
    let port;
    const host = '0.0.0.0';

    before((done) => {
        freeport((err, p) => {
            if (err) {
                throw err;
            }
            port = p;
            server = httpServer.createServer({
                root: path.join(__dirname, 'fixtures', 'website'),
            });
            server.listen(port);
            url = `http://${host}:${port}`;

            freeport((poxyErr, proxyPort) => {
                if (poxyErr) {
                    throw poxyErr;
                }

                const routingProxy = new httpProxy.createProxyServer(); // eslint-disable-line
                proxy = http.createServer(basic, (req, res) => {
                    routingProxy.web(req, res, { target: url });
                });
                proxy.listen(proxyPort);
                proxyUrl = `http://${host}:${proxyPort}`;
                done();
            });
        });
    });

    after((done) => {
        proxy.close(() => {
          server.close();
          done();
        });
    });


    describe('should be able to crawl', () => {
        it('a website', () => {
            const crawler = new CrawlKit(url);
            const results = {};
            results[`${url}/`] = {};
            return crawler.crawl().should.eventually.deep.equal({results});
        });

        describe('with a finder', () => {
            it('that is custom', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {};
                results[`${url}/#somehash`] = {};
                results[`${url}/other.html`] = {};

                crawler.setFinder({ getRunnable: () => genericLinkFinder});
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('that allows parameters', () => {
                const crawler = new CrawlKit(`${url}/other.html`);

                const results = {};
                results[`${url}/other.html`] = {};
                results[`${url}/ajax.html`] = {};

                crawler.setFinder({ getRunnable: () => genericLinkFinder }, 2000);
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('that has an incorrect return value', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {};

                crawler.setFinder({
                    getRunnable: () => function incorrectReturnFilter() {
                        window.callPhantom(null, 'notAnArray');
                    },
                });
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('that doesn\'t return URLs', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {};
                results[`${url}/other.html`] = {};
                results[`${url}/hidden.html`] = {};

                crawler.setFinder({
                    getRunnable: () => function incorrectReturnFilter() {
                        window.callPhantom(null, [
                            'other.html',
                            null,
                            'hidden.html',
                        ]);
                    },
                });
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('that is erroneous', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {
                    error: 'Some arbitrary error',
                };
                crawler.setFinder({
                    getRunnable: () => function erroneusFinder() {
                        window.callPhantom('Some arbitrary error', null);
                    },
                });
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('that throws an exception', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {
                    error: 'Error: Some thrown error',
                };
                crawler.setFinder({
                    getRunnable: () => function erroneusFinder() {
                        throw new Error('Some thrown error');
                    },
                });
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('that never returns', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {
                    error: 'Finder timed out after 1000ms.',
                };
                crawler.timeout = 1000;
                crawler.setFinder({ getRunnable: () => function neverReturningFilter() {} });
                return crawler.crawl().should.eventually.deep.equal({results});
            });
        });

        describe('urlFilter', () => {
            it('and filter the results', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {};
                results[`${url}/other.html`] = {};

                const spy = sinon.spy((u) => {
                  if (u.indexOf('somehash') !== -1) {
                      return false;
                  }
                  return u;
                });

                crawler.setFinder({
                    getRunnable: () => genericLinkFinder,
                    urlFilter: spy,
                });


                return crawler.crawl().then((result) => {
                    spy.callCount.should.equal(2);
                    return result.results;
                }).should.eventually.deep.equal(results);
            });

            it('and rewrite the results', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {};
                results[`${url}/redirected.html`] = {};
                results[`${url}/other.html`] = {};

                crawler.setFinder({
                    getRunnable: () => genericLinkFinder,
                    urlFilter: (u) => {
                      if (u.indexOf('somehash') !== -1) {
                          return 'redirected.html';
                      }
                      return u;
                  },
                });

                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('should handle faulty rewrites', () => {
                const crawler = new CrawlKit(url);

                const results = {};
                results[`${url}/`] = {};

                crawler.setFinder({
                    getRunnable: () => genericLinkFinder,
                    urlFilter: () => {},
                });

                return crawler.crawl().should.eventually.deep.equal({results});
            });
        });
    });

    it('should fall back to http', () => {
        const crawler = new CrawlKit(`//${host}:${port}`);
        return crawler.crawl().should.be.fulfilled;
    });

    it('should not fail on dead links', () => {
        const crawler = new CrawlKit(`${url}/deadlinks.html`);

        const results = {};
        results[`${url}/deadlinks.html`] = {};
        results[`${url}/nonexistent.html`] = {
            error: `Failed to open ${url}/nonexistent.html`,
        };
        results[`${url}/404.html`] = {
            error: `Failed to open ${url}/404.html`,
        };
        crawler.setFinder({ getRunnable: () => genericLinkFinder});
        return crawler.crawl().should.eventually.deep.equal({results});
    });

    describe('runners', () => {
        it('should be possible to use', () => {
            const crawler = new CrawlKit(url);

            crawler.addRunner('a', {
                getCompanionFiles: () => [],
                getRunnable: () => function a() { window.callPhantom(null, 'a'); },
            });
            crawler.addRunner('b', {
                getCompanionFiles: () => [],
                getRunnable: () => function b() { window.callPhantom('b', null); },
            });

            const results = {};
            results[`${url}/`] = {
                runners: {
                    a: {
                        result: 'a',
                    },
                    b: {
                        error: 'b',
                    },
                },
            };
            return crawler.crawl().should.eventually.deep.equal({results});
        });

        it('should be able to run async', () => {
            const crawler = new CrawlKit(url);
            crawler.addRunner('async', {
                getCompanionFiles: () => [],
                getRunnable: () => {
                    return function delayedRunner() {
                        window.setTimeout(function delayedCallback() {
                            window.callPhantom(null, 'success');
                        }, 2000);
                    };
                },
            });

            const results = {};
            results[`${url}/`] = {
                runners: {
                    async: {
                        result: 'success',
                    },
                },
            };
            return crawler.crawl().should.eventually.deep.equal({results});
        });

        describe('companion files', () => {
            it('synchronously', () => {
                const crawler = new CrawlKit(url);
                crawler.addRunner('companion', {
                    getCompanionFiles: () => [
                        path.join(__dirname, 'fixtures/companionA.js'),
                        path.join(__dirname, 'fixtures/companionB.js'),
                    ],
                    getRunnable: () => {
                        return function callingGlobalRunner() {
                            window.companionB();
                        };
                    },
                });

                const results = {};
                results[`${url}/`] = {
                    runners: {
                        companion: {
                            result: 'success',
                        },
                    },
                };
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('async with a Promise', () => {
                const crawler = new CrawlKit(url);
                crawler.addRunner('companion', {
                    getCompanionFiles: () => Promise.resolve([
                        path.join(__dirname, 'fixtures/companionA.js'),
                        path.join(__dirname, 'fixtures/companionB.js'),
                    ]),
                    getRunnable: () => {
                        return function callingGlobalRunner() {
                            window.companionB();
                        };
                    },
                });

                const results = {};
                results[`${url}/`] = {
                    runners: {
                        companion: {
                            result: 'success',
                        },
                    },
                };
                return crawler.crawl().should.eventually.deep.equal({results});
            });
        });

        it('should time out', () => {
            const crawler = new CrawlKit(url);
            crawler.timeout = 1000;
            crawler.addRunner('x', {
                getCompanionFiles: () => [],
                getRunnable: () => function noop() {},
            });

            const results = {};
            results[`${url}/`] = {
                runners: {
                    x: {
                        error: `Runner 'x' timed out after 1000ms.`,
                    },
                },
            };
            return crawler.crawl().should.eventually.deep.equal({results});
        });

        describe('Parameters', () => {
            it('should accept one parameter', () => {
                const crawler = new CrawlKit(url);
                crawler.addRunner('param', {
                    getCompanionFiles: () => [],
                    getRunnable: () => {
                        return function callingGlobalRunner(a) {
                            window.callPhantom(null, a);
                        };
                    },
                }, 'a');

                const results = {};
                results[`${url}/`] = {
                    runners: {
                        param: {
                            result: 'a',
                        },
                    },
                };
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('should accept multiple parameters', () => {
                const crawler = new CrawlKit(url);
                crawler.addRunner('param', {
                    getCompanionFiles: () => [],
                    getRunnable: () => {
                        return function callingGlobalRunner(a, b, c) {
                            window.callPhantom(null, [a, b, c]);
                        };
                    },
                }, 'a', 'b', 'c');

                const results = {};
                results[`${url}/`] = {
                    runners: {
                        param: {
                            result: ['a', 'b', 'c'],
                        },
                    },
                };
                return crawler.crawl().should.eventually.deep.equal({results});
            });

            it('should default missing parameters to undefined', () => {
                const crawler = new CrawlKit(url);
                crawler.addRunner('param', {
                    getCompanionFiles: () => [],
                    getRunnable: () => {
                        return function callingGlobalRunner(a) {
                            window.callPhantom(null, typeof a === 'undefined');
                        };
                    },
                });

                const results = {};
                results[`${url}/`] = {
                    runners: {
                        param: {
                            result: true,
                        },
                    },
                };
                return crawler.crawl().should.eventually.deep.equal({results});
            });
        });
    });

    describe('redirects', () => {
        it('should not be followed by default', () => {
            const crawler = new CrawlKit(`${url}/redirect.html`);
            const results = {};
            results[`${url}/redirect.html`] = {};
            return crawler.crawl().should.eventually.deep.equal({results});
        });

        it('should be followed when the according setting is enabled', () => {
            const redirectUrl = `${url}/redirect.html`;
            const targetUrl = `${url}/redirected.html`;
            const crawler = new CrawlKit(redirectUrl);
            crawler.followRedirects = true;
            const results = {};
            results[redirectUrl] = {
                error: `page for ${redirectUrl} redirected to ${targetUrl}`,
            };
            results[targetUrl] = {};
            return crawler.crawl().should.eventually.deep.equal({results});
        });
    });

    describe('cookies', () => {
        it('should be added to the page if given', () => {
          const crawler = new CrawlKit(url);

          crawler.browserCookies = [{
              name: 'cookie',
              value: 'monster',
              path: '/',
              domain: host,
          }];

          crawler.addRunner('cookies', {
              getCompanionFiles: () => [],
              getRunnable: () => {
                return function getCookies() {
                    window.callPhantom(null, document.cookie);
                };
              },
          });

          const results = {};
          results[`${url}/`] = {
              runners: {
                  cookies: {
                      result: 'cookie=monster',
                  },
              },
          };
          return crawler.crawl().should.eventually.deep.equal({results});
        });
    });

    describe('settings', () => {
        it('should be possible to set a page setting', () => {
            const crawler = new CrawlKit(url);
            crawler.phantomPageSettings = {
                userAgent: 'Mickey Mouse',
            };
            crawler.addRunner('agent', {
                getCompanionFiles: () => [],
                getRunnable: () => {
                    return function userAgentRunner() {
                        window.callPhantom(null, navigator.userAgent);
                    };
                },
            });

            const results = {};
            results[`${url}/`] = {
                runners: {
                    agent: {
                        result: 'Mickey Mouse',
                    },
                },
            };
            return crawler.crawl().should.eventually.deep.equal({results});
        });


        it('should be possible to set basic auth headers', () => {
            const crawler = new CrawlKit(proxyUrl);
            crawler.phantomPageSettings = {
                userName: 'foo',
                password: 'bar',
            };

            const results = {};
            results[`${proxyUrl}/`] = {};
            results[`${proxyUrl}/#somehash`] = {};
            results[`${proxyUrl}/other.html`] = {};

            crawler.setFinder({ getRunnable: () => genericLinkFinder });
            return crawler.crawl().should.eventually.deep.equal({results});
        });
    });

    describe('resilience', () => {
        it('should be able to retry failed attempts when Phantom dies', () => {
            const crawler = new CrawlKit(url);

            let fails = 3;
            const flakyRunnable = sinon.spy(() => {
                if (--fails > 0) {
                    throw new HeadlessError();
                }
                return function resolvingFunction() {
                    window.callPhantom(null, 'final result');
                };
            });

            crawler.addRunner('flaky', {
                getCompanionFiles: () => [],
                getRunnable: flakyRunnable,
            });

            const results = {};
            results[`${url}/`] = {
                runners: {
                    flaky: {
                        result: 'final result',
                    },
                },
            };

            return crawler.crawl().then((result) => {
                flakyRunnable.should.have.been.calledThrice;
                return result;
            }).should.eventually.deep.equal({results});
        });

        describe('should only try every so often', () => {
            let crawler;
            let flakyRunnable;
            let results;

            beforeEach(() => {
                crawler = new CrawlKit(url);

                flakyRunnable = sinon.spy(() => {
                    throw new HeadlessError();
                });

                crawler.addRunner('flaky', {
                    getCompanionFiles: () => [],
                    getRunnable: flakyRunnable,
                });

                results = {};
                results[`${url}/`] = {
                    error: {
                        message: undefined,
                        name: 'HeadlessError',
                    },
                    runners: {},
                };
            });

            it('every = default', () => {
                return crawler.crawl().then((result) => {
                    flakyRunnable.should.have.been.calledThrice;
                    return result;
                }).should.eventually.deep.equal({results});
            });

            it('or how many times defined', () => {
                crawler.retries = 2;

                return crawler.crawl().then((result) => {
                    flakyRunnable.should.have.been.calledTwice;
                    return result;
                }).should.eventually.deep.equal({results});
            });
        });
    });

    describe('streaming', () => {
        it('should be possible to read from the stream', (done) => {
            const crawler = new CrawlKit(url);

            crawler.setFinder({ getRunnable: () => genericLinkFinder });

            crawler.addRunner('agent', {
                getCompanionFiles: () => [],
                getRunnable: () => {
                    return function xRunner() {
                        window.callPhantom(null, 'X');
                    };
                },
            });

            const results = {};
            results[`${url}/`] = {runners: {agent: {result: 'X'}}};
            results[`${url}/#somehash`] = {runners: {agent: {result: 'X'}}};
            results[`${url}/other.html`] = {runners: {agent: {result: 'X'}}};
            const stream = crawler.crawl(true);

            let streamed = '';
            stream.on('data', (data) => {
                streamed += data;
            });
            stream.on('end', () => {
                JSON.parse(streamed).should.deep.equal(results);
                done();
            });
        });
    });
});
