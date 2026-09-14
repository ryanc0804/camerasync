import 'api_client.dart';

/// A group the user belongs to — the subset of the server's `publicGroup`
/// shape (apps/server/src/routes/groups.js) the mobile app needs.
class Group {
  const Group({required this.id, required this.name});

  final String id;
  final String name;

  factory Group.fromJson(Map<String, dynamic> json) => Group(
        id: json['id'].toString(),
        name: (json['name'] ?? '').toString(),
      );
}

/// REST calls for groups, mirroring apps/web/src/api/groups.js.
class GroupsApi {
  const GroupsApi(this._api);

  final ApiClient _api;

  /// Every group the current user belongs to.
  Future<List<Group>> getMyGroups() async {
    final data = await _api.get('/api/groups');
    final groups = (data as Map)['groups'] as List;
    return groups
        .map((g) => Group.fromJson(Map<String, dynamic>.from(g)))
        .toList();
  }
}
