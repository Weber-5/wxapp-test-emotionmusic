#!/usr/bin/env python3
"""
数据库修复脚本
添加缺失的 action 列到 play_history 表
"""

import sqlite3
import os

def fix_database():
    """修复数据库表结构"""
    db_path = 'music_recommendations.db'
    
    if not os.path.exists(db_path):
        print(f"数据库文件 {db_path} 不存在")
        return
    
    try:
        # 连接数据库
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 检查 play_history 表是否存在 action 列
        cursor.execute("PRAGMA table_info(play_history)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'action' not in columns:
            print("添加 action 列到 play_history 表...")
            cursor.execute('ALTER TABLE play_history ADD COLUMN action TEXT')
            print("✓ action 列添加成功")
        else:
            print("✓ action 列已存在")
        
        # 检查是否需要添加其他缺失的列
        if 'play_mode' not in columns:
            print("添加 play_mode 列到 play_history 表...")
            cursor.execute('ALTER TABLE play_history ADD COLUMN play_mode TEXT DEFAULT "auto"')
            print("✓ play_mode 列添加成功")
        
        # 提交更改
        conn.commit()
        
        # 显示表结构
        print("\n当前 play_history 表结构:")
        cursor.execute("PRAGMA table_info(play_history)")
        for column in cursor.fetchall():
            print(f"  {column[1]} ({column[2]}) - {'NOT NULL' if column[3] else 'NULLABLE'}")
        
        print("\n数据库修复完成！")
        
    except Exception as e:
        print(f"修复数据库时出错: {e}")
        if 'conn' in locals():
            conn.rollback()
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    fix_database()
