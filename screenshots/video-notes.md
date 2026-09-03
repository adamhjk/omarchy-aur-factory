Walk you through how this works.

Basically, someone requests a package to be built for Omachi by filling in this form.

Then an administrator reviews it, and approves it.

This then kicks off the build, which uses a swamp workflow to download the source, evalaute it, look at the rules for building arch packages and write the build, then build it and vet it with all the standard tools. 

If it runs into an error, you'll be shown all the build logs, and then you can provide a hint for the next retry. If it's a pure lint failure, it'll just fix it automatically.

Then when its done it gets published (this is all fake right now) to an unstable channel, and then a maintainer and a user both say the package works and then it ships to stable.

Lets build a package we believe will fail, so you see the whole loop:

lazygit
https://github.com/jesseduffield/lazygit/archive/refs/tags/v0.64.1.tar.gz
Simple terminal UI for git commands
MIT

Then we will find the test failure and fix it

Then approve it

You can get the source at github.com/adamhjk/omarchy-aur-factory
