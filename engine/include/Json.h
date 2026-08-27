#pragma once
// Json.h — dependency-free JSON writer plus a tiny reader good enough for the
// flat request bodies exchanged with the Node API layer.

#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace mvcc {
namespace json {

std::string escape(const std::string& in);

class Writer {
public:
    Writer& beginObject();
    Writer& endObject();
    Writer& beginArray(const std::string& key);
    Writer& beginArray();
    Writer& endArray();
    Writer& key(const std::string& k);
    Writer& value(const std::string& v);
    Writer& value(const char* v) { return value(std::string(v)); }
    Writer& value(long long v);
    Writer& value(int v) { return value(static_cast<long long>(v)); }
    Writer& value(double v);
    Writer& value(bool v);
    Writer& kv(const std::string& k, const std::string& v) { return key(k).value(v); }
    Writer& kv(const std::string& k, const char* v) { return key(k).value(v); }
    Writer& kv(const std::string& k, long long v) { return key(k).value(v); }
    Writer& kv(const std::string& k, int v) { return key(k).value(v); }
    Writer& kv(const std::string& k, double v) { return key(k).value(v); }
    Writer& kv(const std::string& k, bool v) { return key(k).value(v); }
    Writer& raw(const std::string& r);

    std::string str() const { return out_.str(); }

private:
    void comma();
    std::ostringstream out_;
    std::vector<bool> firstStack_;
    bool needComma_ = false;
};

// Flat parser: returns string values for every top level scalar key.
std::map<std::string, std::string> parseFlat(const std::string& body);
long long toInt(const std::map<std::string, std::string>& m, const std::string& k, long long def);
std::string toStr(const std::map<std::string, std::string>& m, const std::string& k,
                  const std::string& def = "");

}  // namespace json
}  // namespace mvcc
