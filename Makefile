jwt:
	jwtgen -a RS256 -p /Users/ahmedkamel/Documents/GitHub/taskmill-ops/deploy/saltstack/file_root/.key/jwt/key -c "iss=localhost" -c "sub=agent@localhost" -c "aud=make" -e 3600 > ./config/.jwt

stress:
	docker run --rm williamyeh/wrk -t1 -c1 -d30s --header "blob: bW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihyZXEsIHJlcywgbmV4dCkgew0KICByZXMuc2VuZCgnSGVsbG8gV29ybGQhJyk7DQp9Ow0K" http://192.168.1.15:8070/github.com/a7medkamel/taskmill-help/blob/master/$.js




# Running 30s test @ http://192.168.1.15:8070/github.com/a7medkamel/taskmill-help/blob/master/js
#   1 threads and 1 connections
#   Thread Stats   Avg      Stdev     Max   +/- Stdev
#     Latency     0.00us    0.00us   0.00us    -nan%
#     Req/Sec     0.00      0.00     0.00    100.00%
#   8 requests in 30.05s, 3.18KB read
#   Socket errors: connect 0, read 0, write 0, timeout 8
# Requests/sec:      0.27
# Transfer/sec:     108.34B
