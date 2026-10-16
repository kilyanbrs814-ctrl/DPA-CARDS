// Register the custom URL scheme used by Supabase admin magic links.
// Mutates only the ephemeral Xcode project generated inside GitHub Actions.
import Foundation

guard CommandLine.arguments.count == 2 else {
  fatalError("Usage: swift configure-ios-deeplink.swift ios/App/App/Info.plist")
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let data = try Data(contentsOf: url)
var originalFormat = PropertyListSerialization.PropertyListFormat.xml
guard var root = try PropertyListSerialization.propertyList(from: data, options: [], format: &originalFormat) as? [String: Any] else {
  fatalError("Invalid Info.plist")
}
var types = root["CFBundleURLTypes"] as? [[String: Any]] ?? []
let hasScheme = types.contains { type in
  (type["CFBundleURLSchemes"] as? [String] ?? []).contains("dpacards")
}
if !hasScheme {
  types.append([
    "CFBundleURLName": "fr.digitalprojectagency.cards",
    "CFBundleTypeRole": "Editor",
    "CFBundleURLSchemes": ["dpacards"]
  ])
  root["CFBundleURLTypes"] = types
  let result = try PropertyListSerialization.data(fromPropertyList: root, format: originalFormat, options: 0)
  try result.write(to: url, options: .atomic)
}
print("DPA Cards iOS auth redirect scheme configured: dpacards://auth/admin")
