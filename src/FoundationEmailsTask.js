import fs from 'fs';
import path from "path";
import {mergeWith, isArray} from 'lodash';


let $ = {}, del, inky, siphon, lazypipe, gutil, async, deasync;

class FoundationEmailsTask extends Elixir.Task {

    /**
     * Create a new JavaScriptTask instance.
     *
     * @param  {string}      name
     * @param  {object|null} options
     */
    constructor(name, options) {
        super(name, null, null);

        this.options = options;

        if (fs.existsSync('foundation-emails.config.js')) {
            this.userFoundationEmailsConfig = require(process.cwd() + '/foundation-emails.config.js');
        }

        this.config = this.mergeConfig();
        this.config.sassFilename = path.posix.basename(this.config.sass, '.scss');

        this.src = [];
        this.output = [];
    }

    /**
     * Lazy load the task dependencies.
     */
    loadDependencies() {
        $.if = require('gulp-if');
        $.sourcemaps = require('gulp-sourcemaps');
        $.sass = require('gulp-sass');
        $.imagemin = require('gulp-imagemin');
        $.uncss = require('gulp-uncss');
        $.htmlmin = require('gulp-htmlmin');
        $.inlineCss = require('gulp-inline-css');
        $.replace = require('gulp-replace');

        del = require('del');
        inky = require('inky');
        siphon = require('siphon-media-query');
        lazypipe = require('lazypipe');
        gutil = require('gulp-util');
        async = require('async');
        deasync = require('deasync');
    }

    /**
     * Register file watchers.
     */
    registerWatchers() {
        if (Elixir.isWatching()) {
            let self = this;
            Elixir.hooks.watch.push(() => {
                self.watch();
            });
        }
    }

    /**
     * Build up the Gulp task.
     *
     * callback don't have a callback(done), so need to use deasync to run this stream inside the gulp task
     */
    gulpTask() {
        let self = this;
        let sync = true;

        self.clean();

        async.series([
            next => {
                self.pages()
                    .on('error', err => {
                        gutil.log(err);
                        self.onError()(err)
                    })
                    .on('end', next);
            },
            next => {
                self.sass()
                    .on('error', err => {
                        gutil.log(err);
                        self.onError()(err)
                    })
                    .on('end', next);
            },
            next => {
                self.images()
                    .on('error', err => {
                        gutil.log(err);
                        self.onError()(err)
                    })
                    .on('end', next);
            },
            next => {
                self.inline()
                    .on('error', err => {
                        gutil.log(err);
                        self.onError()(err)
                    })
                    .on('end', next);
            },
            next => {
                // compile output paths
                self.output = self.output.map(file => {
                    if (file.match(/\*/) || fs.existsSync(file)) {
                        return gutil.colors.green(file);
                    }

                    return gutil.colors.bgRed(file);
                }).join('\n');
                next();
            }
        ], () => {
            gulp.src('')
                .pipe(new Elixir.Notification('Foundation emails Compiled!'))
                .on('end', () => {
                    sync = false;
                })
                .emit('end');
        });

        while (sync) {
            deasync.sleep(100);
        }

        return true;
    }


    /**
     * Merge the FoundationEmails config.
     *
     * @return {object}
     */
    mergeConfig() {
        return mergeWith(
            Elixir.foundationEmails.config,
            this.userFoundationEmailsConfig,
            this.options,
            (objValue, srcValue) => {
                if (isArray(objValue)) {
                    return objValue.concat(srcValue);
                }
            }
        );
    }

    // Delete the "dist" folder
    // This happens every time a build starts
    clean() {
        const config = this.config;

        this.recordStep('Clean compiled');

        del.sync([
            config.compiled,
            config.views,
            config.publicCss + '/' + config.sassFilename + '.css',
            config.imagesDist
        ]);
    }

    // Compile layouts, pages, and partials into flat HTML files
    // Then parse using Inky templates
    pages() {
        this.recordStep('Compiling Templates');
        const config = this.config;

        this.addSrcPath(config.source + '/**/*.blade.php');
        this.addOutputPath(config.views);

        return gulp
            .src(config.source + '/**/*.blade.php')
            .pipe(inky())
            .pipe($.replace('-&gt;', '->'))
            .pipe($.replace('=&gt;', '=>'))
            .pipe($.replace('&quot;', '"'))
            .pipe($.replace('&apos;', '\''))
            .pipe(gulp.dest(config.views));
    }

    // Compile Sass into CSS
    sass() {
        this.recordStep('Compiling Sass');
        const config = this.config;

        this.addSrcPath(config.sass);
        this.addOutputPath(config.compiled + '/css/' + config.sassFilename + '.css');
        if (!Elixir.config.production) {
            this.addOutputPath(config.publicCss + '/' + config.sassFilename + '.css');
        }

        return gulp
            .src(config.sass)
            .pipe($.if(Elixir.config.sourcemaps, $.sourcemaps.init()))
            .pipe($.sass({
                errLogToConsole: true
            }).on('error', $.sass.logError))
            .pipe($.if(Elixir.config.production, $.uncss(
                {
                    html: [config.views + '/**/*.blade.php']
                })))
            .pipe($.if(Elixir.config.sourcemaps, $.sourcemaps.write()))
            .pipe($.if(!Elixir.config.production, gulp.dest(config.publicCss)))
            .pipe(gulp.dest(config.compiled + '/css'));
    }

    // Copy and compress images
    images() {
        this.recordStep('Minifing Images');
        const config = this.config;

        this.addSrcPath(config.images + '/**/*');
        this.addOutputPath(config.imagesDist);

        return gulp
            .src(config.images + '/**/*')
            .pipe($.imagemin())
            .pipe(gulp.dest(config.imagesDist));
    }

    // Inline CSS and minify HTML
    inline() {
        const config = this.config;

        if(Elixir.config.production) {
            this.recordStep('Inlining Css');
        }

        return gulp
            .src(config.views + '/**/*.blade.php')
            .pipe($.if(Elixir.config.production, this.inliner(config.compiled + '/css/' + config.sassFilename + '.css')))
            .pipe(gulp.dest(config.views));
    }

    // Inline CSS into HTML, adds media query CSS into the <style> tag of the email, and compresses the HTML
    inliner(css) {
        css = fs.readFileSync(css).toString();
        let mqCss = siphon(css);

        let additionalCss = '';
        let blade = [];

        let pipe = lazypipe()
            .pipe($.replace, /<style type="text\/css" media="screen">([\s\S]+?)<\/style>/g, (match, p1) => {
                additionalCss += "\n" + p1;
                return '';
            })
            .pipe($.replace, /<link rel="stylesheet" type="text\/css" href="[^"]+?">/, '')
            .pipe($.replace, /(\{\{.+?\}\}|\{!!.+?!!\})/g, (match, p1) => {
                blade.push(p1);
                return '@__@gulp@blade__@';
            })
            .pipe($.replace, '<!-- <style> -->', '@__@gulp@style__@')
            .pipe($.inlineCss, {
                applyStyleTags: false,
                removeStyleTags: true,
                preserveMediaQueries: true,
                removeLinkTags: false,
                extraCss: css
            })
            .pipe($.htmlmin, {
                collapseWhitespace: true,
                minifyCSS: true
            })
            .pipe($.replace, '@__@gulp@style__@', () => {
                return '<style>' + additionalCss + "\n" + mqCss + '</style>';
            })
            .pipe($.replace, /(@__@gulp@blade__@)/g, () => {
                return blade.shift();
            });

        return pipe();
    }

    // Watch for file changes
    watch() {
        this.isWatching = true;

        let self = this;
        const config = this.config;
        let sassDir = path.posix.dirname(config.sass);

        // watch blade
        gulp.watch(config.source + '/**/*.blade.php').on('change', () => {
            async.series([
                next => {
                    self.pages()
                        .on('error', self.onError)
                        .on('end', next);
                }], () => {
                gulp.src('').pipe(new Elixir.Notification('Foundation emails templates Compiled!')).emit('end');
            });
        });

        // watch sass
        gulp.watch(sassDir + '/**/*.scss').on('change', () => {
            async.series([
                next => {
                    self.pages()
                        .on('error', self.onError)
                        .on('end', next);
                },
                next => {
                    self.sass()
                        .on('error', self.onError)
                        .on('end', next);
                },
                next => {
                    self.inline()
                        .on('error', self.onError)
                        .on('end', next);
                }
            ], () => {
                gulp.src('').pipe(new Elixir.Notification('Foundation emails Compiled!')).emit('end');
            });
        });

        // watch images
        gulp.watch(config.images + '/**/*').on('change', () => {
            async.series([
                next => {
                    self.images()
                        .on('error', self.onError)
                        .on('end', next);
                }], () => {
                gulp.src('').pipe(new Elixir.Notification('Foundation emails images minified!')).emit('end');
            });
        });
    }

    addSrcPath(path) {
        if (!this.isWatching)
            this.src.push(path);
    }

    addOutputPath(path) {
        if (!this.isWatching)
            this.output.push(path);
    }
}


export default FoundationEmailsTask;
