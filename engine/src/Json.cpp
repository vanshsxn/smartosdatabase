#include "Json.h"

#include <cmath>
#include <cstdio>

namespace mvcc {
namespace json {

std::string escape(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 8);
    for (char c : in) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

void Writer::comma() {
    if (needComma_) out_ << ",";
    needComma_ = true;
}

Writer& Writer::beginObject() {
    comma();
    out_ << "{";
    needComma_ = false;
    return *this;
}

Writer& Writer::endObject() {
    out_ << "}";
    needComma_ = true;
    return *this;
}

Writer& Writer::beginArray() {
    comma();
    out_ << "[";
    needComma_ = false;
    return *this;
}

Writer& Writer::beginArray(const std::string& k) {
    key(k);
    out_ << "[";
    needComma_ = false;
    return *this;
}

Writer& Writer::endArray() {
    out_ << "]";
    needComma_ = true;
    return *this;
}

Writer& Writer::key(const std::string& k) {
    comma();
    out_ << "\"" << escape(k) << "\":";
    needComma_ = false;
    return *this;
}

Writer& Writer::value(const std::string& v) {
    comma();
    out_ << "\"" << escape(v) << "\"";
    needComma_ = true;
    return *this;
}

Writer& Writer::value(long long v) {
    comma();
    out_ << v;
    needComma_ = true;
    return *this;
}

Writer& Writer::value(double v) {
    comma();
    if (std::isnan(v) || std::isinf(v)) {
        out_ << "0";
    } else {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.3f", v);
        out_ << buf;
    }
    needComma_ = true;
    return *this;
}

Writer& Writer::value(bool v) {
    comma();
    out_ << (v ? "true" : "false");
    needComma_ = true;
    return *this;
}

Writer& Writer::raw(const std::string& r) {
    comma();
    out_ << r;
    needComma_ = true;
    return *this;
}

std::map<std::string, std::string> parseFlat(const std::string& body) {
    std::map<std::string, std::string> out;
    size_t i = 0;
    auto skipWs = [&]() {
        while (i < body.size() && std::isspace(static_cast<unsigned char>(body[i]))) i++;
    };
    auto readString = [&](std::string& dst) -> bool {
        if (i >= body.size() || body[i] != '"') return false;
        i++;
        while (i < body.size() && body[i] != '"') {
            if (body[i] == '\\' && i + 1 < body.size()) {
                i++;
                char c = body[i];
                if (c == 'n') dst += '\n';
                else if (c == 't') dst += '\t';
                else dst += c;
            } else {
                dst += body[i];
            }
            i++;
        }
        i++;  // closing quote
        return true;
    };

    while (i < body.size()) {
        skipWs();
        if (i >= body.size()) break;
        if (body[i] != '"') { i++; continue; }
        std::string key;
        if (!readString(key)) break;
        skipWs();
        if (i < body.size() && body[i] == ':') i++;
        skipWs();
        if (i >= body.size()) break;
        if (body[i] == '"') {
            std::string val;
            readString(val);
            out[key] = val;
        } else if (body[i] == '{' || body[i] == '[') {
            // skip nested structures
            int depth = 0;
            while (i < body.size()) {
                if (body[i] == '{' || body[i] == '[') depth++;
                if (body[i] == '}' || body[i] == ']') {
                    depth--;
                    if (depth == 0) { i++; break; }
                }
                i++;
            }
        } else {
            std::string val;
            while (i < body.size() && body[i] != ',' && body[i] != '}' && body[i] != ']' &&
                   !std::isspace(static_cast<unsigned char>(body[i]))) {
                val += body[i];
                i++;
            }
            out[key] = val;
        }
    }
    return out;
}

long long toInt(const std::map<std::string, std::string>& m, const std::string& k, long long def) {
    auto it = m.find(k);
    if (it == m.end() || it->second.empty()) return def;
    try {
        return std::stoll(it->second);
    } catch (...) {
        return def;
    }
}

std::string toStr(const std::map<std::string, std::string>& m, const std::string& k,
                  const std::string& def) {
    auto it = m.find(k);
    if (it == m.end()) return def;
    return it->second;
}

}  // namespace json
}  // namespace mvcc
