/*
 * grunt-locales Grunt task
 * https://github.com/blueimp/grunt-locales
 *
 * Copyright 2013, Sebastian Tschan
 * https://blueimp.net
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/MIT
 */

/*jslint regexp: true, unparam: true, nomen: true */
/*global module, require, global, __dirname */

module.exports = function (grunt) {
    'use strict';

    function LocalesTask(task) {
        this.options = task.options({
            locales: ['en_US'],
            localizeAttributes: [
                'localize',
                'localize-title'
            ],
            // Matches the locale name in a file path,
            // e.g. "en_US" in js/locale/en_US/i18n.json:
            localeRegExp: /\w+(?=\/[^\/]+$)/,
            localePlaceholder: '{locale}',
            localeName: 'i18n',
            // Purge obsolete locale messages by default:
            purgeLocales: true,
            messageFormatFile:
                __dirname + '/../node_modules/messageformat/locale/{locale}.js',
            localeTemplate: __dirname + '/../i18n.js.tmpl',
            jsonSpace: 2,
            csvEncapsulator: '"',
            csvDelimiter: ',',
            csvLineEnd: '\r\n',
            csvEscape: function (str) {
                return str.replace(/"/g, '""');
            },
            csvKeyLabel: 'ID',
            // Allow ftp, http(s), mailto, anchors
            // and messageformat variables (href="{url}"):
            urlRegExp: /^((ftp|https?):\/\/|mailto:|#|\{\w+\})/
        });
        if (!this.options.locales.length) {
            return grunt.fail.warn('No locales defined');
        }
        this.task = task;
        this.done = task.async();
        this[task.target]();
    }

    grunt.registerMultiTask(
        'locales',
        'Update, build, import and export locales.',
        function () {
            return new LocalesTask(this);
        }
    );

    function extend(dst) {
        grunt.util.toArray(arguments).forEach(function (obj) {
            var key;
            if (obj && obj !== dst) {
                for (key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        dst[key] = obj[key];
                    }
                }
            }
        });
        return dst;
    }

    extend(LocalesTask.prototype, {
        extend: extend,

        getAttributesSelector: function () {
            if (!this.attributesSelector) {
                var items = [];
                this.options.localizeAttributes.forEach(function (id) {
                    items.push('[' + id + '],[data-' + id + ']');
                });
                this.attributesSelector = items.join(',');
            }
            return this.attributesSelector;
        },

        getAttributeValue: function (attrs, id) {
            var dataId = 'data-' + id;
            return (attrs[id] && attrs[id].nodeValue) ||
                (attrs[dataId] && attrs[dataId].nodeValue);
        },

        parseTemplate: function (file, callback) {
            var that = this,
                messages = {};
            require('apricot').Apricot.open(file, function (err, doc) {
                if (err) {
                    grunt.log.error(err);
                    return callback.call(that);
                }
                doc.find(that.getAttributesSelector());
                doc.each(function (el) {
                    that.options.localizeAttributes.forEach(function (id) {
                        if (!el.hasAttribute(id)) {
                            return;
                        }
                        var val = that.getAttributeValue(el.attributes, id);
                        // Empty attributes can have their attribute name
                        // as attribute value on some environments (e.g. OSX):
                        if (val === id) {
                            val = '';
                        }
                        if (!val && id === 'localize') {
                            // Retrieve the element content and
                            // set the HTML5 version of empty tags:
                            val = el.innerHTML.replace(/ \/>/g, '>');
                        }
                        if (val) {
                            messages[val] = val;
                        }
                    });
                });
                callback.call(that, messages);
            });
        },

        getSourceFiles: function () {
            var files = this.task.filesSrc;
            if (this.task.args.length) {
                files = this.task.args;
            }
            return files.filter(function (file) {
                if (!grunt.file.exists(file)) {
                    grunt.log.warn('Source file ' + file.cyan + ' not found.');
                    return false;
                }
                return true;
            });
        },

        getDestinationFilePath: function () {
            var dest = this.task.files.length && this.task.files[0].dest;
            if (!dest) {
                grunt.fail.warn('Missing destination file path.');
                return this.done();
            }
            return dest;
        },

        getLocaleFromPath: function (path) {
            var regexp = this.options.localeRegExp,
                localeMatch = regexp.exec(path),
                locale = localeMatch && localeMatch[0];
            if (!locale) {
                grunt.fail.warn(
                    'Regular expression ' + regexp.toString().cyan +
                        ' failed to match locale in path ' +
                        path.cyan + '.'
                );
                return this.done();
            }
            return locale;
        },

        getLocaleTemplate: function () {
            var file = this.options.localeTemplate;
            if (!grunt.file.exists(file)) {
                grunt.fail.warn('Locale template ' + file.cyan + ' not found.');
                return this.done();
            }
            return grunt.file.read(file);
        },

        needsTranslationFunction: function (key, value) {
            return (key !== value) || /\{/.test(value);
        },

        cleanupTranslationFunction: function (content) {
            var dataCheckRegExp =
                /if\(!d\)\{\nthrow new Error\("MessageFormat: No data passed to function\."\);\n\}/g;
            return content
                .replace(
                    /var r = "";\nr \+= (".*?";)\nreturn r;/,
                    function (match, p1, offset, str) {
                        if (p1) {
                            return 'return ' + p1;
                        }
                        return str;
                    }
                )
                .replace(/^(function\()d(\)\{\nreturn)/, '$1$2')
                .replace(dataCheckRegExp, 'd = d || {};');
        },

        getMessageFormatLocale: function (locale) {
            var file = this.options.messageFormatFile.replace(
                this.options.localePlaceholder,
                locale.slice(0, 2)
            );
            if (!grunt.file.exists(file)) {
                grunt.fail.warn('MessageFormat file ' + file.cyan + ' not found.');
                return this.done();
            }
            return grunt.file.read(file);
        },

        messageFormatFactory: function (locale, messageFormatLocale) {
            if (!global.MessageFormat) {
                global.MessageFormat = require('messageformat');
            }
            require('vm').createScript(
                messageFormatLocale || this.getMessageFormatLocale(locale)
            ).runInThisContext();
            return new global.MessageFormat(locale.slice(0, 2));
        },

        logMessageFormatError: function (e, key, locale) {
            grunt.log.warn(
                'MessageFormat ' + e.name + ':\n',
                'Error:  ' + e.message + '\n',
                'Column: ' + e.column + '\n',
                'Line:   ' + e.line + '\n',
                'Key:    ' + key.replace('\n', '\\n') + '\n',
                'Locale: ' + locale
            );
        },

        parse: function (callback) {
            var that = this,
                counter = 0,
                messages = {};
            this.getSourceFiles().forEach(function (file) {
                counter += 1;
                that.parseTemplate(file, function (parsedMessages) {
                    grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
                    that.extend(messages, parsedMessages);
                    counter -= 1;
                    if (!counter) {
                        callback.call(that, messages);
                    }
                });
            });
            if (!counter) {
                callback.call(that, messages);
            }
        },

        update: function () {
            var that = this,
                dest = this.getDestinationFilePath();
            this.parse(function (parsedMessages) {
                var defaultMessagesFile = that.options.defaultMessagesFile,
                    defaultMessages;
                if (defaultMessagesFile) {
                    if (!grunt.file.exists(defaultMessagesFile)) {
                        grunt.log.warn('Locale file ' + defaultMessagesFile.cyan + ' not found.');
                    } else {
                        defaultMessages = grunt.file.readJSON(defaultMessagesFile);
                        grunt.log.writeln('Parsed locales from ' + defaultMessagesFile.cyan + '.');
                    }
                }
                that.options.locales.forEach(function (locale) {
                    var localeFile = dest.replace(that.options.localePlaceholder, locale),
                        messages = {},
                        sortedMessages = {},
                        definedMessages;
                    if (grunt.file.exists(localeFile)) {
                        definedMessages = grunt.file.readJSON(localeFile);
                        grunt.log.writeln('Parsed locales from ' + localeFile.cyan + '.');
                    }
                    // If all templates have been parsed and the purgeLocales options is set,
                    // only keep defined messages which exist as default or parsed messages:
                    that.extend(
                        messages,
                        parsedMessages,
                        defaultMessages,
                        (that.task.args.length || !that.options.purgeLocales) && definedMessages
                    );
                    // JavaScript objects are not ordered, however, creating a new object
                    // based on sorted keys creates a more consistent JSON output:
                    Object.keys(messages).sort().forEach(function (key) {
                        sortedMessages[key] = (definedMessages && definedMessages[key]) ||
                            messages[key];
                    });
                    grunt.file.write(
                        localeFile,
                        JSON.stringify(
                            sortedMessages,
                            that.options.jsonReplacer,
                            that.options.jsonSpace
                        ) + '\n'
                    );
                    grunt.log.writeln(
                        (definedMessages ? 'Updated' : 'Created') +
                            ' locale file ' + localeFile.cyan + '.'
                    );
                });
                that.done();
            });
        },

        build: function () {
            var that = this,
                dest = this.getDestinationFilePath();
            this.getSourceFiles().forEach(function (file) {
                var locale = that.getLocaleFromPath(file),
                    destFile = dest.replace(that.options.localePlaceholder, locale),
                    locales = grunt.file.readJSON(file),
                    messageFormatLocale = that.getMessageFormatLocale(locale),
                    functionsMap = {},
                    messageFormat = that.messageFormatFactory(locale, messageFormatLocale);
                Object.keys(locales).sort().forEach(function (key) {
                    var func;
                    if (!that.needsTranslationFunction(key, locales[key])) {
                        return;
                    }
                    try {
                        func = messageFormat.precompile(
                            messageFormat.parse(String(locales[key]))
                        );
                    } catch (e) {
                        return that.logMessageFormatError(e, key, locale);
                    }
                    functionsMap[key] = that.cleanupTranslationFunction(func);
                });
                grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
                grunt.file.write(destFile, grunt.template.process(
                    that.getLocaleTemplate(),
                    {
                        data: {
                            locale: locale,
                            localeName: that.options.localeName,
                            messageFormatLocale: messageFormatLocale,
                            functionsMap: functionsMap
                        }
                    }
                ));
                grunt.log.writeln('Updated locale file ' + destFile.cyan + '.');
            });
            this.done();
        },

        'export': function () {
            var that = this,
                dest = this.getDestinationFilePath(),
                options = this.options,
                locales = options.locales,
                localesMap = {},
                encapsulator = options.csvEncapsulator,
                delimiter = options.csvDelimiter,
                lineEnd = options.csvLineEnd,
                escapeFunc = options.csvEscape,
                str = encapsulator + this.options.csvKeyLabel + encapsulator;
            this.getSourceFiles().forEach(function (file) {
                localesMap[that.getLocaleFromPath(file)] = grunt.file.readJSON(file);
                grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
            });
            locales.forEach(function (locale) {
                str += delimiter + encapsulator + locale + encapsulator;
            });
            str += lineEnd;
            Object.keys(localesMap[locales[0]]).sort().forEach(function (key) {
                str +=  encapsulator + escapeFunc(key) + encapsulator;
                locales.forEach(function (locale) {
                    str += delimiter + encapsulator +
                        escapeFunc(localesMap[locale][key]) +
                        encapsulator;
                });
                str += lineEnd;
            });
            grunt.file.write(dest, str);
            grunt.log.writeln('Exported locales to ' + dest.cyan + '.');
            this.done();
        },

        'import': function () {
            var that = this,
                locales = this.options.locales,
                localesMap = {},
                messageFormatMap = {},
                keyLabel = this.options.csvKeyLabel,
                csv = require('csv'),
                urlRegExp = this.options.urlRegExp,
                sanitizer = require('sanitizer'),
                sanitizeUrlCallback = function (value) {
                    if (urlRegExp.test(value)) {
                        return value;
                    }
                },
                files = this.getSourceFiles(),
                dest = this.getDestinationFilePath();
            if (!files.length) {
                grunt.log.warn('No import source file found.');
                return this.done();
            }
            locales.forEach(function (locale) {
                localesMap[locale] = {};
                messageFormatMap[locale] = that.messageFormatFactory(locale);
            });
            files.forEach(function (file) {
                csv().from.path(file, {columns: true})
                    .transform(function (row) {
                        var key = row[keyLabel];
                        locales.forEach(function (locale) {
                            var str = row[locale];
                            if (!str) {
                                return;
                            }
                            try {
                                messageFormatMap[locale].parse(str);
                            } catch (e) {
                                return that.logMessageFormatError(e, key, locale);
                            }
                            if (str.indexOf('<') === -1) {
                                localesMap[locale][key] = str;
                            } else {
                                localesMap[locale][key] = sanitizer.sanitize(
                                    str,
                                    sanitizeUrlCallback
                                );
                            }
                        });
                    })
                    .on('end', function () {
                        grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
                        Object.keys(localesMap).forEach(function (locale) {
                            var localeFile = dest.replace(
                                that.options.localePlaceholder,
                                locale
                            );
                            grunt.file.write(
                                localeFile,
                                JSON.stringify(
                                    localesMap[locale],
                                    that.options.jsonReplacer,
                                    that.options.jsonSpace
                                ) + '\n'
                            );
                            grunt.log.writeln('Updated locale file ' + localeFile.cyan + '.');
                        });
                        that.done();
                    });
            });
        }

    });

};
