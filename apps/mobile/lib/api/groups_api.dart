import 'api_client.dart';

/// A group the user belongs to — the subset of the server's `publicGroup`
/// shape (apps/server/src/routes/groups.js) the mobile app needs.
class Group {
  const Group({
    required this.id,
    required this.name,
    required this.isPublic,
    this.isMember = false,
    this.primaryColor,
  });

  final String id;
  final String name;
  final bool isPublic;
  final bool isMember;

  /// The team color as `#rrggbb`, when the server sent one.
  final String? primaryColor;

  factory Group.fromJson(Map<String, dynamic> json) => Group(
        id: json['id'].toString(),
        name: (json['name'] ?? '').toString(),
        isPublic: json['isPublic'] == true,
        isMember: json['isMember'] == true || json['is_member'] == true,
        primaryColor: json['primaryColor'] as String?,
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

  /// Search for groups by ID (up to 5 results)
  Future<List<Group>> searchGroups(String query) async {
    final data = await _api.get('/api/groups/search?q=${Uri.encodeQueryComponent(query)}');
    final groups = (data as Map)['groups'] as List;
    return groups
        .map((g) => Group.fromJson(Map<String, dynamic>.from(g)))
        .toList();
  }

  /// Create a group; the server makes the creator its owner and admin.
  /// [id] must be letters and numbers only, and a private group needs a
  /// [password] (both checked server-side too, see POST /api/groups).
  Future<Group> createGroup({
    required String id,
    required String name,
    required bool isPublic,
    String password = '',
    String primaryColor = '#ffc72c',
  }) async {
    final data = await _api.post('/api/groups', {
      'id': id,
      'name': name,
      'isPublic': isPublic,
      if (!isPublic) 'password': password,
      'primaryColor': primaryColor,
    });
    return Group.fromJson(
      Map<String, dynamic>.from((data as Map)['group'] as Map),
    );
  }

  /// Join a group (provides password if private)
  Future<Group> joinGroup(String id, [String password = '']) async {
    final data = await _api.post('/api/groups/${Uri.encodeComponent(id)}/join', password.isEmpty ? null : {'password': password});
    return Group.fromJson(Map<String, dynamic>.from((data as Map)['group'] as Map));
  }
}
