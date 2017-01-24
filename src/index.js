import { mergeWith, isArray } from 'lodash';
import FoundationEmailsTask from './FoundationEmailsTask';

/*
 |----------------------------------------------------------------
 | Foundation for Emails 2
 |----------------------------------------------------------------
 |
 | This task will allow you to use Foundation for Emails 2
 | Quickly create responsive HTML emails that work.
 | Even on Outlook. http://foundation.zurb.com/emails.html
 |
 | And use it with Laravel blade templates.
 |
 */

Elixir.foundationEmails = {
    config: {
        sass: 'resources/assets/sass/emails/email.scss',
        source: 'resources/emails',
        views: 'resources/views/emails',
        images: 'resources/emails/images',
        imagesDist: 'public/images/emails',
        publicCss: 'public/css',
        compiled: 'resources/emails/dist'
    },

    mergeConfig(newConfig) {
        return this.config = mergeWith(this.config, newConfig, (objValue, srcValue) => {
                if (isArray(objValue)) {
            return objValue.concat(srcValue);
        }
    });
    }
};


Elixir.extend('foundationEmails', options => {
    new FoundationEmailsTask(
        'foundationEmails', options
    );
});