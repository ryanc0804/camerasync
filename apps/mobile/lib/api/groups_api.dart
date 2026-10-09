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
    this.joinedAt,
    this.owner,
    this.role,
    this.inviteUrl,
  });

  final String id;
  final String name;
  final bool isPublic;
  final bool isMember;

  /// The team color as `#rrggbb`, when the server sent one.
  final String? primaryColor;

  /// When the current user joined, for picking a default primary group.
  final DateTime? joinedAt;

  /// The owner's user id, and the current user's role in the group
  /// ('admin', 'member' or 'viewer'; the owner also has 'admin').
  final int? owner;
  final String? role;

  /// The link members share to invite people (the web app's join page).
  final String? inviteUrl;

  /// Admins and the owner can change the team color and manage members.
  bool canManage(int? userId) =>
      role == 'admin' || (owner != null && owner == userId);

  factory Group.fromJson(Map<String, dynamic> json) => Group(
        id: json['id'].toString(),
        name: (json['name'] ?? '').toString(),
        isPublic: json['isPublic'] == true,
        isMember: json['isMember'] == true || json['is_member'] == true,
        primaryColor: json['primaryColor'] as String?,
        joinedAt: DateTime.tryParse('${json['joinedAt'] ?? ''}'),
        owner: (json['owner'] as num?)?.toInt(),
        role: json['role'] as String?,
        inviteUrl: json['inviteUrl'] as String?,
      );
}

/// One person on a group's roster.
class GroupMember {
  const GroupMember({required this.id, required this.name, required this.role});

  final int id;
  final String name;

  /// 'admin', 'member' or 'viewer'.
  final String role;

  factory GroupMember.fromJson(Map<String, dynamic> json) => GroupMember(
        id: (json['id'] as num).toInt(),
        name: (json['name'] ?? 'Unnamed member').toString(),
        role: (json['role'] ?? 'member').toString(),
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
    final data = await _api
        .get('/api/groups/search?q=${Uri.encodeQueryComponent(query)}');
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
    String primaryColor = '#ead217',
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
    final data = await _api.post('/api/groups/${Uri.encodeComponent(id)}/join',
        password.isEmpty ? null : {'password': password});
    return Group.fromJson(
        Map<String, dynamic>.from((data as Map)['group'] as Map));
  }

  /// A group's roster, owner first. Members only.
  Future<List<GroupMember>> getMembers(String groupId) async {
    final data =
        await _api.get('/api/groups/${Uri.encodeComponent(groupId)}/members');
    final members = ((data as Map)['members'] as List?) ?? const [];
    return members
        .map((m) => GroupMember.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  /// Move a member up or down the viewer < member < admin ladder. The server
  /// checks the caller outranks them.
  Future<void> changeMemberRole(
      String groupId, int memberId, String role) async {
    await _api.patch(
      '/api/groups/${Uri.encodeComponent(groupId)}/members/$memberId',
      {'role': role},
    );
  }

  Future<void> removeMember(String groupId, int memberId) async {
    await _api.delete(
        '/api/groups/${Uri.encodeComponent(groupId)}/members/$memberId');
  }

  /// Change the team color (admins and the owner only). Returns the group.
  Future<Group> updateColor(String groupId, String primaryColor) async {
    final data = await _api.patch(
      '/api/groups/${Uri.encodeComponent(groupId)}',
      {'primaryColor': primaryColor},
    );
    return Group.fromJson(
        Map<String, dynamic>.from((data as Map)['group'] as Map));
  }

  /// Rename the group or change its privacy (owner only). A private group
  /// needs [password] unless it already has one.
  Future<Group> updateDetails(
    String groupId, {
    required String name,
    required bool isPublic,
    String password = '',
  }) async {
    final data =
        await _api.patch('/api/groups/${Uri.encodeComponent(groupId)}', {
      'name': name,
      'isPublic': isPublic,
      if (password.isNotEmpty) 'password': password,
    });
    return Group.fromJson(
        Map<String, dynamic>.from((data as Map)['group'] as Map));
  }

  /// Leave a group. The owner has to hand it to someone else first.
  Future<void> leave(String groupId) async {
    await _api.post('/api/groups/${Uri.encodeComponent(groupId)}/leave');
  }

  /// Make another member the owner; the old owner stays on as an admin.
  Future<Group> transfer(String groupId, int userId) async {
    final data = await _api.post(
      '/api/groups/${Uri.encodeComponent(groupId)}/transfer',
      {'userId': userId},
    );
    return Group.fromJson(
        Map<String, dynamic>.from((data as Map)['group'] as Map));
  }

  /// Delete the group with all its sessions and recordings (owner only).
  Future<void> deleteGroup(String groupId) async {
    await _api.delete('/api/groups/${Uri.encodeComponent(groupId)}');
  }
}
