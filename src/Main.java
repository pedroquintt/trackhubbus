import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

public class Main {
    static class Company {int id; String name;}
    static class Line {int id; int companyId; String name; List<RoutePoint> route = new ArrayList<>();}
    static class Bus {int id; int lineId; String code;}
    static class Passenger {int id; String name; String photoDataUrl;}
    static class RoutePoint {double lat; double lng; RoutePoint(double a,double b){lat=a;lng=b;}}

    static class State {
        Map<Integer, Company> companies = new HashMap<>();
        Map<Integer, Line> lines = new HashMap<>();
        Map<Integer, Bus> buses = new HashMap<>();
        Map<Integer, Passenger> passengers = new HashMap<>();
        Map<Integer, List<String>> lineSchedules = new HashMap<>();
        List<Ad> ads = new ArrayList<>();
        int companySeq = 1;
        int lineSeq = 1;
        int busSeq = 1;
        int passengerSeq = 1;
        int adSeq = 1;
    }

    static State state = new State();

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(8000), 0);
        server.createContext("/", new StaticHandler());
        server.createContext("/api/admin/company", new AdminCompanyHandler());
        server.createContext("/api/admin/line", new AdminLineHandler());
        server.createContext("/api/admin/bus", new AdminBusHandler());
        server.createContext("/api/admin/route", new AdminRouteHandler());
        server.createContext("/api/admin/schedule", new AdminScheduleHandler());
        server.createContext("/api/line/schedule", new LineScheduleGetHandler());
        server.createContext("/api/admin/ad", new AdminAdHandler());
        server.createContext("/api/ads", new AdsGetHandler());
        server.createContext("/api/plan", new PlannerHandler());
        server.createContext("/api/passenger/register", new PassengerRegisterHandler());
        server.createContext("/api/passenger/searchRoutes", new PassengerSearchRoutesHandler());
        server.createContext("/api/routes/stream", new RouteStreamHandler());
        server.createContext("/api/routes/get", new RouteGetHandler());
        server.createContext("/api/buses/near", new BusesNearHandler());
        server.createContext("/api/bus/stream", new BusStreamHandler());
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
    }

    static class Ad {int id; String title; String imageUrl; String linkUrl;}

    static void sendJson(HttpExchange ex, int code, String body) throws IOException {
        Headers h = ex.getResponseHeaders();
        h.set("Content-Type", "application/json; charset=utf-8");
        h.set("Cache-Control", "no-store");
        ex.sendResponseHeaders(code, body.getBytes(StandardCharsets.UTF_8).length);
        try (OutputStream os = ex.getResponseBody()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
    }

    static String readBody(HttpExchange ex) throws IOException {
        byte[] buf = ex.getRequestBody().readAllBytes();
        return new String(buf, StandardCharsets.UTF_8);
    }

    static Map<String,String> parseQuery(String raw) {
        if (raw == null || raw.isEmpty()) return Collections.emptyMap();
        Map<String,String> m = new HashMap<>();
        for (String p : raw.split("&")) {
            String[] kv = p.split("=",2);
            String k = URLDecoder.decode(kv[0], StandardCharsets.UTF_8);
            String v = kv.length>1 ? URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "";
            m.put(k,v);
        }
        return m;
    }

    static String jsonString(String s) {return s==null?"null":"\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}

    static class StaticHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            String path = ex.getRequestURI().getPath();
            if (path.startsWith("/api/")) { sendJson(ex,404,"{}" ); return; }
            if (path.equals("/") || path.equals("")) path = "/index.html";
            File f = new File("public" + path);
            if (!f.exists() || f.isDirectory()) { f = new File("public/index.html"); }
            String ct = contentType(f.getName());
            Headers h = ex.getResponseHeaders();
            h.set("Content-Type", ct);
            ex.sendResponseHeaders(200, f.length());
            try (OutputStream os = ex.getResponseBody(); FileInputStream fis = new FileInputStream(f)) {
                fis.transferTo(os);
            }
        }
        String contentType(String name){
            String n = name.toLowerCase();
            if (n.endsWith(".html")) return "text/html; charset=utf-8";
            if (n.endsWith(".css")) return "text/css; charset=utf-8";
            if (n.endsWith(".js")) return "application/javascript; charset=utf-8";
            if (n.endsWith(".png")) return "image/png";
            if (n.endsWith(".jpg")||n.endsWith(".jpeg")) return "image/jpeg";
            return "application/octet-stream";
        }
    }

    static class AdminCompanyHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { sendJson(ex,405,"{}"); return; }
            String body = readBody(ex);
            String name = extractField(body, "name");
            Company c = new Company();
            c.id = state.companySeq++;
            c.name = name;
            state.companies.put(c.id, c);
            sendJson(ex,200,"{\"id\":"+c.id+",\"name\":"+jsonString(c.name)+"}");
        }
    }

    static class AdminLineHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { sendJson(ex,405,"{}"); return; }
            String body = readBody(ex);
            int companyId = parseInt(extractField(body, "companyId"));
            String name = extractField(body, "name");
            Line l = new Line();
            l.id = state.lineSeq++;
            l.companyId = companyId;
            l.name = name;
            state.lines.put(l.id, l);
            sendJson(ex,200,"{\"id\":"+l.id+",\"companyId\":"+l.companyId+",\"name\":"+jsonString(l.name)+"}");
        }
    }

    static class AdminBusHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { sendJson(ex,405,"{}"); return; }
            String body = readBody(ex);
            int lineId = parseInt(extractField(body, "lineId"));
            String code = extractField(body, "code");
            Bus b = new Bus();
            b.id = state.busSeq++;
            b.lineId = lineId;
            b.code = code;
            state.buses.put(b.id, b);
            sendJson(ex,200,"{\"id\":"+b.id+",\"lineId\":"+b.lineId+",\"code\":"+jsonString(b.code)+"}");
        }
    }

    static class AdminRouteHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { sendJson(ex,405,"{}"); return; }
            String body = readBody(ex);
            int lineId = parseInt(extractField(body, "lineId"));
            String pointsRaw = extractArray(body, "points");
            Line l = state.lines.get(lineId);
            if (l == null) { sendJson(ex,404,"{}"); return; }
            l.route.clear();
            for (String item : splitItems(pointsRaw)) {
                double lat = Double.parseDouble(extractField(item, "lat"));
                double lng = Double.parseDouble(extractField(item, "lng"));
                l.route.add(new RoutePoint(lat,lng));
            }
            sendJson(ex,200,"{\"ok\":true,\"count\":"+l.route.size()+"}");
        }
    }

    static class AdminScheduleHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { sendJson(ex,405,"{}"); return; }
            String body = readBody(ex);
            int lineId = parseInt(extractField(body, "lineId"));
            String timesRaw = extractArray(body, "times");
            List<String> times = new ArrayList<>();
            for (String item : splitItems(timesRaw)) {
                String t = extractField(item, "time");
                if (t!=null && !t.isEmpty()) times.add(t);
            }
            state.lineSchedules.put(lineId, times);
            sendJson(ex,200,"{\"ok\":true,\"count\":"+times.size()+"}");
        }
    }

    static class LineScheduleGetHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            Map<String,String> q = parseQuery(ex.getRequestURI().getQuery());
            int lineId = parseInt(q.getOrDefault("line","0"));
            List<String> times = state.lineSchedules.getOrDefault(lineId, List.of("06:00","07:00","08:00","12:00","17:30"));
            String next = nextDeparture(times);
            sendJson(ex,200,"{\"times\":"+toJsonArray(times)+",\"next\":"+jsonString(next)+"}");
        }
    }

    static String toJsonArray(List<String> arr){
        StringBuilder sb = new StringBuilder();
        sb.append("["); boolean first=true; for(String s:arr){ if(!first) sb.append(","); first=false; sb.append(jsonString(s)); } sb.append("]"); return sb.toString();
    }

    static String nextDeparture(List<String> times){
        java.time.LocalTime now = java.time.LocalTime.now();
        java.time.LocalTime best = null;
        for (String t:times){
            try {
                java.time.LocalTime lt = java.time.LocalTime.parse(t);
                if (lt.isAfter(now) && (best==null || lt.isBefore(best))) best = lt;
            } catch(Exception ignore) {}
        }
        return best==null? (times.isEmpty()?"":times.get(0)) : best.toString();
    }

    static class AdminAdHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { sendJson(ex,405,"{}"); return; }
            String body = readBody(ex);
            Ad ad = new Ad();
            ad.id = state.adSeq++;
            ad.title = extractField(body, "title");
            ad.imageUrl = extractField(body, "imageUrl");
            ad.linkUrl = extractField(body, "linkUrl");
            state.ads.add(ad);
            sendJson(ex,200,"{\"id\":"+ad.id+"}");
        }
    }

    static class AdsGetHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            StringBuilder sb = new StringBuilder();
            sb.append("["); boolean first=true; for(Ad a:state.ads){ if(!first) sb.append(","); first=false; sb.append("{\"id\":").append(a.id).append(",\"title\":").append(jsonString(a.title)).append(",\"imageUrl\":").append(jsonString(a.imageUrl)).append(",\"linkUrl\":").append(jsonString(a.linkUrl)).append("}"); } sb.append("]");
            sendJson(ex,200,sb.toString());
        }
    }

    static class PlannerHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            Map<String,String> q = parseQuery(ex.getRequestURI().getQuery());
            double oLat = Double.parseDouble(q.getOrDefault("originLat","-27.65"));
            double oLng = Double.parseDouble(q.getOrDefault("originLng","-48.65"));
            double dLat = Double.parseDouble(q.getOrDefault("destLat","-27.66"));
            double dLng = Double.parseDouble(q.getOrDefault("destLng","-48.65"));
            Line bestLine = null; int oIdx=0, dIdx=0; int bestLen = Integer.MAX_VALUE;
            for (Line l : state.lines.values()) {
                List<RoutePoint> r = l.route.isEmpty()?seedDefaultRoute():l.route;
                int oi = nearestIndex(r, oLat, oLng);
                int di = nearestIndex(r, dLat, dLng);
                if (oi<=di) {
                    int len = di-oi;
                    if (len<bestLen) {bestLen=len; bestLine=l; oIdx=oi; dIdx=di;}
                }
            }
            if (bestLine==null) { bestLine = seedDefaultLine(); List<RoutePoint> r = bestLine.route; oIdx=0; dIdx=Math.min(5, r.size()-1); }
            List<RoutePoint> r = bestLine.route.isEmpty()?seedDefaultRoute():bestLine.route;
            int hopMin = 2; int estMin = Math.max(1, (dIdx-oIdx)*hopMin);
            String next = nextDeparture(state.lineSchedules.getOrDefault(bestLine.id, List.of("06:00","07:00","08:00","12:00","17:30")));
            StringBuilder sb = new StringBuilder();
            sb.append("{\"line\":").append(bestLine.id).append(",\"name\":").append(jsonString(bestLine.name)).append(",\"estimatedMinutes\":").append(estMin).append(",\"nextDeparture\":").append(jsonString(next)).append(",\"segment\":[");
            boolean first=true; for(int i=oIdx;i<=dIdx;i++){ if(!first) sb.append(","); first=false; RoutePoint p=r.get(i); sb.append("{\"lat\":").append(p.lat).append(",\"lng\":").append(p.lng).append("}"); }
            sb.append("]}");
            sendJson(ex,200,sb.toString());
        }
    }

    static int nearestIndex(List<RoutePoint> r, double lat, double lng){
        int idx = 0; double best = Double.MAX_VALUE; for(int i=0;i<r.size();i++){ RoutePoint p=r.get(i); double d=(p.lat-lat)*(p.lat-lat)+(p.lng-lng)*(p.lng-lng); if (d<best){best=d; idx=i;} } return idx;
    }

    static class BusState {int busId; int lineId; int idx; double speed;}
    static java.util.concurrent.ScheduledExecutorService ticker;
    static boolean tickerStarted = false;
    static Map<Integer, BusState> busStates = new HashMap<>();

    static void ensureTicker(){
        if (tickerStarted) return;
        ticker = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
        if (state.buses.isEmpty()) {
            Line l = state.lines.isEmpty()?seedDefaultLine():state.lines.values().iterator().next();
            for (int k=0;k<3;k++){ Bus b=new Bus(); b.id=state.busSeq++; b.lineId=l.id; b.code="SIM"+(k+1); state.buses.put(b.id,b);}            
        }
        for (Bus b : state.buses.values()) {
            BusState bs = new BusState(); bs.busId=b.id; bs.lineId=b.lineId; bs.idx=(int)(Math.random()*10); bs.speed=1; busStates.put(b.id, bs);
        }
        ticker.scheduleAtFixedRate(() -> {
            for (BusState bs : busStates.values()) {
                Line l = state.lines.get(bs.lineId);
                List<RoutePoint> r = l==null?seedDefaultRoute(): (l.route.isEmpty()?seedDefaultRoute():l.route);
                bs.idx = (bs.idx + (int)bs.speed) % r.size();
            }
        }, 0, 1, java.util.concurrent.TimeUnit.SECONDS);
        tickerStarted = true;
    }

    static class BusesNearHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            ensureTicker();
            Map<String,String> q = parseQuery(ex.getRequestURI().getQuery());
            double lat = Double.parseDouble(q.getOrDefault("lat","-27.65"));
            double lng = Double.parseDouble(q.getOrDefault("lng","-48.65"));
            boolean hasDest = q.containsKey("destLat") && q.containsKey("destLng");
            double dLat = Double.parseDouble(q.getOrDefault("destLat","0"));
            double dLng = Double.parseDouble(q.getOrDefault("destLng","0"));
            int hopMin = 2;
            StringBuilder sb = new StringBuilder(); sb.append("["); boolean first=true;
            for (BusState bs : busStates.values()) {
                Line l = state.lines.get(bs.lineId);
                if (l==null) continue; List<RoutePoint> r = l.route.isEmpty()?seedDefaultRoute():l.route;
                int stopIdx = nearestIndex(r, lat, lng);
                int destIdx = hasDest? nearestIndex(r, dLat, dLng) : stopIdx;
                if (hasDest && bs.idx>destIdx) { // aproximação de direção
                    continue;
                }
                double dist = distanceAlong(r, bs.idx, stopIdx);
                double speedMps = 5.0; // ~18 km/h
                int eta = (int)Math.round(dist / (speedMps*60.0));
                RoutePoint p = r.get(bs.idx % r.size());
                if (!first) sb.append(","); first=false;
                String arrival = java.time.LocalTime.now().plusMinutes(eta).toString();
                sb.append("{\"busId\":").append(bs.busId).append(",\"lineId\":").append(l.id).append(",\"name\":").append(jsonString(l.name)).append(",\"lat\":").append(p.lat).append(",\"lng\":").append(p.lng).append(",\"etaMinutes\":").append(eta).append(",\"arrivalTime\":").append(jsonString(arrival)).append("}");
            }
            sb.append("]");
            sendJson(ex,200,sb.toString());
        }
    }

    static class BusStreamHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            ensureTicker();
            Map<String,String> q = parseQuery(ex.getRequestURI().getQuery());
            int busId = parseInt(q.getOrDefault("id","0"));
            double tLat = Double.parseDouble(q.getOrDefault("targetLat","-27.65"));
            double tLng = Double.parseDouble(q.getOrDefault("targetLng","-48.65"));
            BusState bs = busStates.get(busId);
            if (bs==null) { sendJson(ex,404,"{}"); return; }
            Headers h = ex.getResponseHeaders(); h.set("Content-Type","text/event-stream"); h.set("Cache-Control","no-store"); ex.sendResponseHeaders(200,0);
            OutputStream os = ex.getResponseBody();
            Executors.newSingleThreadExecutor().submit(() -> {
                try {
                    while (true) {
                        Line l = state.lines.get(bs.lineId);
                        List<RoutePoint> r = l==null?seedDefaultRoute(): (l.route.isEmpty()?seedDefaultRoute():l.route);
                        int stopIdx = nearestIndex(r, tLat, tLng);
                        double dist = distanceAlong(r, bs.idx, stopIdx);
                        double speedMps = 5.0; // ~18 km/h
                        int eta = (int)Math.round(dist / (speedMps*60.0));
                        RoutePoint p = r.get(bs.idx % r.size());
                        String arrival = java.time.LocalTime.now().plusMinutes(eta).toString();
                        String data = "data:{\"lat\":"+p.lat+",\"lng\":"+p.lng+",\"etaMinutes\":"+eta+",\"arrivalTime\":"+jsonString(arrival)+",\"lineId\":"+l.id+"}\n\n";
                        os.write(data.getBytes(StandardCharsets.UTF_8)); os.flush();
                        Thread.sleep(1000);
                    }
                } catch (Exception e) { try { os.close(); } catch (IOException ignore) {} }
            });
        }
    }

    static double distanceMeters(RoutePoint a, RoutePoint b){
        double R = 6371000.0;
        double dLat = Math.toRadians(b.lat - a.lat);
        double dLng = Math.toRadians(b.lng - a.lng);
        double sa = Math.sin(dLat/2), sb = Math.sin(dLng/2);
        double h = sa*sa + Math.cos(Math.toRadians(a.lat))*Math.cos(Math.toRadians(b.lat))*sb*sb;
        return 2*R*Math.asin(Math.min(1.0, Math.sqrt(h)));
    }

    static double distanceAlong(List<RoutePoint> r, int fromIdx, int toIdx){
        if (r.isEmpty()) return 0;
        int n = r.size();
        double sum = 0;
        int i = fromIdx;
        while (i != toIdx) {
            RoutePoint a = r.get(i % n);
            RoutePoint b = r.get((i+1) % n);
            sum += distanceMeters(a,b);
            i = (i+1) % n;
            if (sum>1e7) break; // safety guard
        }
        return sum;
    }

    static class PassengerRegisterHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { sendJson(ex,405,"{}"); return; }
            String body = readBody(ex);
            String name = extractField(body, "name");
            String photo = extractField(body, "photoDataUrl");
            Passenger p = new Passenger();
            p.id = state.passengerSeq++;
            p.name = name;
            p.photoDataUrl = photo;
            state.passengers.put(p.id, p);
            sendJson(ex,200,"{\"id\":"+p.id+",\"name\":"+jsonString(p.name)+"}");
        }
    }

    static class PassengerSearchRoutesHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            Map<String,String> q = parseQuery(ex.getRequestURI().getQuery());
            String term = q.getOrDefault("q","" ).toLowerCase();
            StringBuilder sb = new StringBuilder();
            sb.append("[");
            boolean first = true;
            for (Line l : state.lines.values()) {
                if (term.isEmpty() || l.name.toLowerCase().contains(term)) {
                    if (!first) sb.append(",");
                    first = false;
                    sb.append("{\"id\":").append(l.id).append(",\"name\":").append(jsonString(l.name)).append("}");
                }
            }
            sb.append("]");
            sendJson(ex,200,sb.toString());
        }
    }

    static class RouteStreamHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            Map<String,String> q = parseQuery(ex.getRequestURI().getQuery());
            int lineId = parseInt(q.getOrDefault("line","0"));
            Line l = state.lines.get(lineId);
            if (l == null) {
                l = seedDefaultLine();
            }
            Headers h = ex.getResponseHeaders();
            h.set("Content-Type","text/event-stream");
            h.set("Cache-Control","no-store");
            ex.sendResponseHeaders(200, 0);
            OutputStream os = ex.getResponseBody();
            List<RoutePoint> route = l.route.isEmpty()?seedDefaultRoute():l.route;
            Executors.newSingleThreadExecutor().submit(() -> {
                try {
                    int i = 0;
                    while (true) {
                        RoutePoint p = route.get(i % route.size());
                        String data = "data:{\"lat\":"+p.lat+",\"lng\":"+p.lng+"}\n\n";
                        os.write(data.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                        Thread.sleep(1000);
                        i++;
                    }
                } catch (Exception e) {
                    try { os.close(); } catch (IOException ignore) {}
                }
            });
        }
    }

    static class RouteGetHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            if (!ex.getRequestMethod().equalsIgnoreCase("GET")) { sendJson(ex,405,"{}"); return; }
            Map<String,String> q = parseQuery(ex.getRequestURI().getQuery());
            int lineId = parseInt(q.getOrDefault("line","0"));
            Line l = state.lines.get(lineId);
            if (l == null) { l = seedDefaultLine(); }
            List<RoutePoint> route = l.route.isEmpty()?seedDefaultRoute():l.route;
            StringBuilder sb = new StringBuilder();
            sb.append("{\"points\":[");
            boolean first = true;
            for (RoutePoint p : route) {
                if (!first) sb.append(",");
                first = false;
                sb.append("{\"lat\":").append(p.lat).append(",\"lng\":").append(p.lng).append("}");
            }
            sb.append("]}");
            sendJson(ex,200,sb.toString());
        }
    }

    static Line seedDefaultLine() {
        Line l = new Line();
        l.id = state.lineSeq++;
        l.companyId = ensureDefaultCompany();
        l.name = "Centro-Palhoça";
        l.route = seedDefaultRoute();
        state.lines.put(l.id, l);
        return l;
    }

    static int ensureDefaultCompany() {
        if (state.companies.isEmpty()) {
            Company c = new Company();
            c.id = state.companySeq++;
            c.name = "Empresa Palhoça";
            state.companies.put(c.id, c);
            return c.id;
        }
        return state.companies.values().iterator().next().id;
    }

    static List<RoutePoint> seedDefaultRoute() {
        List<RoutePoint> r = new ArrayList<>();
        r.add(new RoutePoint(-27.646, -48.654));
        r.add(new RoutePoint(-27.648, -48.651));
        r.add(new RoutePoint(-27.650, -48.649));
        r.add(new RoutePoint(-27.653, -48.648));
        r.add(new RoutePoint(-27.656, -48.647));
        r.add(new RoutePoint(-27.658, -48.646));
        r.add(new RoutePoint(-27.660, -48.645));
        r.add(new RoutePoint(-27.662, -48.646));
        r.add(new RoutePoint(-27.664, -48.648));
        r.add(new RoutePoint(-27.666, -48.650));
        return r;
    }

    static int parseInt(String s){try {return Integer.parseInt(s);} catch(Exception e){return 0;}}

    static String extractField(String json, String field) {
        String f = "\""+field+"\"";
        int i = json.indexOf(f);
        if (i<0) return "";
        int c = json.indexOf(':', i);
        if (c<0) return "";
        int start = c+1;
        while (start<json.length() && Character.isWhitespace(json.charAt(start))) start++;
        char ch = json.charAt(start);
        if (ch=='\"') {
            int end = json.indexOf('"', start+1);
            if (end<0) return "";
            return json.substring(start+1, end);
        } else {
            int end = start;
            while (end<json.length() && ",}\n\r".indexOf(json.charAt(end))==-1) end++;
            return json.substring(start, end).trim();
        }
    }

    static String extractArray(String json, String field) {
        String f = "\""+field+"\"";
        int i = json.indexOf(f);
        if (i<0) return "[]";
        int c = json.indexOf(':', i);
        int start = json.indexOf('[', c);
        if (start<0) return "[]";
        int depth = 0; int end = start;
        while (end<json.length()) {
            char ch = json.charAt(end);
            if (ch=='[') depth++;
            if (ch==']') {depth--; if (depth==0) break;}
            end++;
        }
        return json.substring(start, end+1);
    }

    static List<String> splitItems(String arrayJson) {
        List<String> items = new ArrayList<>();
        int i = arrayJson.indexOf('[')+1;
        int start = i;
        int depth = 0;
        while (i<arrayJson.length()) {
            char ch = arrayJson.charAt(i);
            if (ch=='{') depth++;
            if (ch=='}') depth--;
            if (ch==',' && depth==0) {
                items.add(arrayJson.substring(start, i));
                start = i+1;
            }
            i++;
        }
        String last = arrayJson.substring(start, arrayJson.lastIndexOf(']'));
        if (!last.trim().isEmpty()) items.add(last);
        return items;
    }
}

