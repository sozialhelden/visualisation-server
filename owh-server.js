'use strict'

var restify = require('restify')
var pg = require('pg')
var cmd = require('commander')

cmd
  .version('1.0.0 -- 2016-10-28')
  .option('-l, --listenerPort [int]', 'listener port of owh-server [8899]',8899)
  .option('-p, --postgresPort [int]', 'postgres port at postgres server [5432]',5432)
  .option('-s, --postgresServer [url]', 'postgres server [localhost]','localhost')
  .parse(process.argv)

var OwhServerOptions = {
    server: {
        name: "owh-server",
        port: cmd.listenerPort // expect requests from visualisation-tool
    },
    database: {
        host: cmd.postgresServer,
        port: cmd.postgresPort,
        database: "cap4access", // SID
        user: "cap4access",
        password: "hv#khs+rs"
    }
}

var OwhServer = (function (options, pgConnectionPool) {
    var serverSpec = options.server
    var dbSpec = options.database

    var connectString = "postgres://" +
        dbSpec.user + ':' + encodeURIComponent(dbSpec.password) +
        '@' + dbSpec.host + ":" + dbSpec.port +
        "/" + dbSpec.database

    // create server
    var server = restify.createServer({
        name: serverSpec.name
    })
    server.use(restify.authorizationParser())
    server.use(restify.queryParser())
    server.use(restify.bodyParser())
    server.use(restify.jsonp())
    server.use(function crossOrigin(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*")
        res.header("Access-Control-Allow-Headers", "X-Requested-With")
        return next()
    })

    server.get('/ping', function (req, res, next) {
        console.log("ping\n")
        res.send("ping " + (new Date().toJSON()))
        console.log("ping end\n")
        return next()
    })

    server.get('/dbtime', function (req, res, next) {
        pgConnectionPool.connect(connectString, function (connErr, client, done) {
            if (connErr) {
                done(client)  // on error remove the client (if truthy) from pool
                console.error('error fetching client from pool', connErr)
                return next()
            }
            client.query('SELECT now()', [], function (qErr, result) {
                if (qErr) {
                    done(client)  // on error remove the client (truthy) from pool
                    return console.error('error running query', qErr)
                } else {
                    done()  // release the client back to the pool
                }
                
                var timenow = result.rows[0].now
                console.log("timelogged: ", timenow)
                res.send(timenow)
                return next()
            })
        })
    })

    var makePrepareBBox = function(cmd, req) {
        console.log("REQUEST: /" + cmd + "/"
            + req.params.swLat + "/" + req.params.swLon + "/"
            + req.params.neLat + "/" + req.params.neLon
        )

        var result = {}
        result.bind = [
                req.params.swLon,
                req.params.swLat,
                req.params.neLon,
                req.params.neLat
            ]
        result.poly = " poly as (select  format('LINESTRING( %1$s %2$s, %3$s %2$s, %3$s %4$s, %1$s %4$s, %1$s %2$s)',$1::text,$2::text,$3::text,$4::text) linestring)"

        return result
    }

    var makeDateRangeSelection = function (dateBegin, dateEnd) {
        console.log("info: dateBegin: " + dateBegin + " dateEnd: " + dateEnd)
        var result = ""
        if (dateBegin && dateEnd) {
            result += " and poi.timestamp BETWEEN TIMESTAMP '" + dateBegin + "' and TIMESTAMP '" + dateEnd + "'"
        } else if (dateBegin) {
            result += " and poi.timestamp >= '" + dateBegin + "'"
        } else if (dateEnd) {
            result += " and poi.timestamp <= '" + dateEnd + "'"
        } else {
            // no time restrictions
        }
        return result
    }

    var make_node_versions = function (dateBegin, dateEnd) {
        var result = " node_versions as "
        + " ( "
        + "     select poi.lfdnr_elem, max(poi.version) max_version "
        + "     from owh_geom x, "
        + "         (select cast ( st_setsrid(ST_MakePolygon(ST_GeomFromText(poly.linestring)),4326) as geometry(Polygon,4326)) geoloc from poly) y, "
        + "         owh poi "
        + "     where st_contains(y.geoloc,x.geoloc) and x.lfdnr_elem = poi.lfdnr_elem "
        + "     and x.type <> 'R' "
        + "     and poi.wheelmap_poi_elem = 1 and poi.visible_vers = 1 "
        + "     and poi.wc_valid_status_change = 1 "
        + makeDateRangeSelection(dateBegin, dateEnd)
        + "     group by poi.lfdnr_elem "
        + " ) " 
        return result
    }


    server.get('/marker/:swLat/:swLon/:neLat/:neLon', function (req, res, next) {
        pgConnectionPool.connect(connectString, function (conError, client, done) {
            if (conError) {
                console.error("connection error: " + conError.message)
                return
            }

            var prepBBox = makePrepareBBox("marker",req)

            var prepareSql = " with" + prepBBox.poly
                    + ", " + make_node_versions(req.params.dateBegin, req.params.dateEnd)
                    + " select cast(poi.lon_elem as double precision) lon,"
                    + "        cast(poi.lat_elem as double precision) lat,"
                    + "        poi.wheelchair_valid wheelchair"
                    + " from owh poi"
                    + " join node_versions b on b.lfdnr_elem = poi.lfdnr_elem and b.max_version = poi.version"
                

            // console.log(prepareSql)

            client.query(prepareSql, prepBBox.bind, function (qErr, queryResult) {
                if (qErr) {
                    done(client)  // on error remove the client (truthy) from pool
                    console.error('error running query', qErr)
                    return next()
                } else {
                    done()  // release the client back to the pool
                }
                
                var count = 0
                var responseResult = queryResult.rows
                    .map(function (obj) {
                        count++
                        var newObj = [
                            obj.lon,
                            obj.lat,
                            obj.wheelchair // !==null?obj.wheelchair:'unknown'
                        ]
                        return newObj
                    })
                console.log("db number of markers: " + count)
                res.send(responseResult)
                return next()
            })

        })
    })

    server.get('/count/:swLat/:swLon/:neLat/:neLon', function (req, res, next) {
        pgConnectionPool.connect(connectString, function (conError, client, done) {
            if (conError) {
                console.error("connection error: " + conError.message)
                return
            }

            var prepBBox = makePrepareBBox("count",req)

            var prepareSql = ""
            if (req.params.dateEnd) {
                prepareSql = " with" + prepBBox.poly
                    + ", " + make_node_versions(req.params.dateBegin, req.params.dateEnd)
                    + " select"
                    + "   sum(case when poi.wheelchair_valid = 'yes' then 1 else 0 end) as yes,"
                    + "   sum(case when poi.wheelchair_valid = 'no' then 1 else 0 end) as no,"
                    + "   sum(case when poi.wheelchair_valid = 'limited' then 1 else 0 end) as limited,"
                    + "   sum(case when poi.wheelchair_valid is null then 1 else 0 end) as unknown"
                    + " from owh poi"
                    + " join node_versions b on b.lfdnr_elem = poi.lfdnr_elem and b.max_version = poi.version"
                    + " "

            } else {
                prepareSql = " with" + prepBBox.poly
                    + " select"
                    + "   sum(case when g.wheelchair_valid = 'yes' then 1 else 0 end) as yes,"
                    + "   sum(case when g.wheelchair_valid = 'no' then 1 else 0 end) as no,"
                    + "   sum(case when g.wheelchair_valid = 'limited' then 1 else 0 end) as limited,"
                    + "   sum(case when g.wheelchair_valid is null then 1 else 0 end) as unknown"
                    + " from owh_geom g,"
                    + "     (select cast ( st_setsrid(ST_MakePolygon(ST_GeomFromText(poly.linestring)),4326) as geometry(Polygon,4326) ) geoloc from poly) p "
                    + " where st_contains(p.geoloc,g.geoloc) and g.wheelmap_poi_elem = 1"
                if (req.params.dateBegin) {
                    prepareSql = prepareSql
                        + " and timestamp >= '" + req.params.dateBegin+"'"
                }

            }
            //  console.log("XXX prepareSql: ", prepareSql)

            client.query(prepareSql, prepBBox.bind, function (qErr, queryResult) {
                if (qErr) {
                    done(client)  // on error remove the client (truthy) from pool
                    console.error('error running query', qErr)
                    return next()
                } else {
                    done()  // release the client back to the pool
                }
                
                var cc = queryResult.rows[0]
                var nb = parseInt(cc.yes) + parseInt(cc.no) + parseInt(cc.limited) + parseInt(cc.unknown)
                console.log("/count/: ", queryResult.rows, nb)
                var queryResult = makeQueryResult(queryResult)
                res.send(queryResult)
                return next()
            })

            function makeQueryResult(queryResult) {
                var row1 = queryResult.rows[0]
                var queryResponse = makeQueryResult_object(row1.yes, row1.limited, row1.no, row1.unknown)
                return queryResponse
            }

            function makeQueryResult_object(accessible, limited_accessible, not_accessible, not_yet_rated) {
                var queryResult = {
                    accessible: [accessible],
                    limited_accessible: [limited_accessible],
                    not_accessible: [not_accessible],
                    not_yet_rated: [not_yet_rated]
                }
                return queryResult
            }

        })
    })


    server.get('/areaCheck', function (req, res, next) {
        pgConnectionPool.connect(connectString, function (connErr, client, done) {
            if (connErr) {
                done(client)  // on error remove the client (if truthy) from pool
                console.error('error fetching client from pool', connErr)
                return next()
            }
            var area = JSON.parse(req.params.area)
            console.log("request: /areaCheck" + area)
            client.query("SELECT LOCATION_PLACE FROM CAP4ACCESS_EXISTING_LOCATION_LIST WHERE LOCATION_NAME =$1::TEXT AND LOCATION_PLACE = $2::TEXT", [area.name,area.place], function (qErr, queryResult) {
                if (qErr) {
                    done(client)  // on error remove the client (truthy) from pool
                    return console.error('error running query', qErr)
                } else {
                    done()  // release the client back to the pool
                }

                res.send( [req.params.area,queryResult.rows.length])

                return next()
            })
        })
    })
    server.get('/insertArea', function (req, res, next) {
        pgConnectionPool.connect(connectString, function (connErr, client, done) {
            if (connErr) {
                done(client)  // on error remove the client (if truthy) from pool
                console.error('error fetching client from pool', connErr)
                return next()
            }
            // convert string
            var area = JSON.parse(req.params.area)
             console.log("request: /area/" + area)
           client.query("INSERT INTO CAP4ACCESS_EXISTING_LOCATION_LIST(location_name,sw_lat,sw_lon,ne_lat,ne_lon,location_place,ispilotsite) VALUES($1,$2,$3,$4,$5,$6,$7)" , [area.name,area.boundingBox.sw.lat,area.boundingBox.sw.lon,area.boundingBox.ne.lat,area.boundingBox.ne.lon,area.place,area.isPilotSite], function (qErr,queryResult) {
                if (qErr) {
                    done(client)  // on error remove the client (truthy) from pool
                    return console.error('error running query', qErr)
                } else {
                    done()  // release the client back to the pool
                }
                console.log("area response.rows: "+area)
                res.send()

                return next()
            })

        })
    })

    server.get('/areas', function (req, res, next) {

        pgConnectionPool.connect(connectString, function (connErr, client, done) {
            if (connErr) {
                done(client)  // on error remove the client (if truthy) from pool
                console.error('error fetching client from pool', connErr)
                return next()
            }

            client.query("SELECT * FROM CAP4ACCESS_EXISTING_LOCATION_LIST", [], function (qErr, queryResult) {
                    if (qErr) {
                        done(client)  // on error remove the client (truthy) from pool
                        return console.error('error running query', qErr)
                    } else {
                        done()  // release the client back to the pool
                    }


                    console.log("response: All Areas  count =" + queryResult.rows.length)

                    res.send(queryResult.rows)
                    return next()
                }
            )

        })
    })

    function testDbConnection() {
        console.log(connectString)
        console.log("database host = %s", dbSpec.host)
        console.log("database port = %d", dbSpec.port)

        pgConnectionPool.connect(connectString, function (connErr, client, done) {
            if (connErr) {
                console.error("database connection error: %j", connErr.message)
                console.error("check database port: %d", dbSpec.port) 
            } else {
                console.log("database connection OK")
            }
        })
    }

    // start server
    server.listen(serverSpec.port, function () {
        console.log("server name = %j", serverSpec.name)
        console.log("server port = %d", serverSpec.port)
        testDbConnection()
    })

})(OwhServerOptions, pg)

