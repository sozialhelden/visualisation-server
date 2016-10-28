# visualisation-server
Versions used

* node : v4.2.6
* npm : 3.5.2

## install

clone from github and install node packages

```bash
git clone https://github.com/sozialhelden/visualisation-server.git
cd visualisation-server
npm install
```

## run
```
$ node owh-server.js -h

  Usage: owh-server [options]

  Options:

    -h, --help                  output usage information
    -V, --version               output the version number
    -l, --listenerPort [int]    listener port of owh-server [8899]
    -p, --postgresPort [int]    postgres port at postgres server [5432]
    -s, --postgresServer [url]  postgres server [localhost]

```

Given default values of the options `-p` and `-s` the visualisation-server
accesses the postgres database at port  `5432` of `localhost`.  
Thus
the postgres database is expected to run on the very server and is accessible
at its default port. The postgres port should NOT be PUBLIC accessible.

By default the visualisation server listens at port `8899`. 
The listener-port may be set by the `-l` option,

## http configuration
The visualisation-tool accesses the visualisation-server (owh-server) at http port 80
with the URL  
`hostname/c4a-server`.

Request to this URL must be passed to the listenerPort.  
If an Apache server is installed, add these redirections to the apache configuration
```
ProxyPass /c4a-server http://localhost:8899
ProxyPassReverse /c4a-server http://localhost:8899

```


